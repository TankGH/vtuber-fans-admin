//! B 站网页接口的最小实现：扫码登录、登录态校验、WBI 签名与大航海快照。
//! 所有函数都是同步阻塞调用，只允许从后台线程或 `spawn_blocking` 中进入，避免卡住 UI。

use std::collections::BTreeMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use md5::{Digest, Md5};
use qrcode::{render::svg, QrCode};
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, COOKIE, REFERER};
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::sync::{GuardMember, SyncSource};

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const QR_GENERATE: &str = "https://passport.bilibili.com/x/passport-login/web/qrcode/generate";
const QR_POLL: &str = "https://passport.bilibili.com/x/passport-login/web/qrcode/poll";
const NAV: &str = "https://api.bilibili.com/x/web-interface/nav";
const GUARD_LIST: &str = "https://api.live.bilibili.com/xlive/app-ucenter/v1/guard/GetGuardList";

/// WBI mixin key 重排表（B 站网页端公开算法）
const MIXIN_TAB: [usize; 64] = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

fn client() -> AppResult<Client> {
    Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent(UA)
        .build()
        .map_err(|e| AppError::new("E_SYNC_NETWORK", format!("网络客户端初始化失败：{e}")))
}

fn network_error(context: &str, err: impl std::fmt::Display) -> AppError {
    AppError::new("E_SYNC_NETWORK", format!("{context}：{err}"))
}

fn api_error(code: i64, message: &str) -> AppError {
    if code == -101 || code == -403 || message.contains("登录") {
        AppError::new("E_SYNC_COOKIE", format!("B 站登录态已失效（{code}），请重新扫码登录"))
    } else {
        AppError::new("E_SYNC_API", format!("B 站接口返回异常（{code}）：{message}"))
    }
}

fn response_code(body: &Value) -> (i64, String) {
    let code = body.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);
    let message = body.get("message").and_then(|v| v.as_str()).unwrap_or("").to_string();
    (code, message)
}

// ---- 扫码登录 ----

#[derive(Debug, Clone)]
pub struct QrTicket {
    pub url: String,
    pub key: String,
}

#[derive(Debug, Clone)]
pub struct QrPollResult {
    /// waiting | scanned | expired | success | error
    pub state: String,
    pub message: String,
    pub cookie: Option<String>,
}

pub fn qr_generate() -> AppResult<QrTicket> {
    let body: Value = client()?
        .get(QR_GENERATE)
        .header(REFERER, "https://passport.bilibili.com/")
        .send()
        .map_err(|e| network_error("获取登录二维码失败，请检查网络", e))?
        .json()
        .map_err(|e| AppError::new("E_SYNC_API", format!("二维码接口响应无法解析：{e}")))?;
    let (code, message) = response_code(&body);
    if code != 0 { return Err(api_error(code, &message)); }
    let data = body.get("data").ok_or_else(|| AppError::new("E_SYNC_API", "二维码接口缺少 data"))?;
    let url = data.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let key = data.get("qrcode_key").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if url.is_empty() || key.is_empty() {
        return Err(AppError::new("E_SYNC_API", "二维码接口未返回登录链接"));
    }
    Ok(QrTicket { url, key })
}

/// 二维码完全在本机生成，登录链接不会发往任何第三方二维码服务
pub fn qr_svg(url: &str) -> AppResult<String> {
    let code = QrCode::new(url.as_bytes())
        .map_err(|e| AppError::new("E_SYNC_API", format!("二维码生成失败：{e}")))?;
    Ok(code
        .render::<svg::Color>()
        .min_dimensions(232, 232)
        .dark_color(svg::Color("#0B1220"))
        .light_color(svg::Color("#ffffff"))
        .build())
}

pub fn qr_poll(key: &str) -> AppResult<QrPollResult> {
    let response = client()?
        .get(QR_POLL)
        .query(&[("qrcode_key", key)])
        .header(REFERER, "https://passport.bilibili.com/")
        .send()
        .map_err(|e| network_error("轮询扫码状态失败，请检查网络", e))?;
    let headers = response.headers().clone();
    let body: Value = response.json()
        .map_err(|e| AppError::new("E_SYNC_API", format!("扫码状态响应无法解析：{e}")))?;
    let (outer, message) = response_code(&body);
    if outer != 0 { return Err(api_error(outer, &message)); }
    let data = body.get("data").cloned().unwrap_or(Value::Null);
    let state_code = data.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);
    let text = data.get("message").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let redirect_url = data.get("url").and_then(|v| v.as_str()).map(str::to_string);
    let result = match state_code {
        0 => {
            let cookie = cookies_from(&headers, redirect_url.as_deref());
            if cookie.is_empty() {
                return Err(AppError::new("E_SYNC_COOKIE", "扫码成功但未取得登录凭证，请重试"));
            }
            QrPollResult { state: "success".into(), message: "扫码登录成功".into(), cookie: Some(cookie) }
        }
        86101 => QrPollResult { state: "waiting".into(), message: "等待扫码，请用 B 站 App 扫描二维码".into(), cookie: None },
        86090 => QrPollResult { state: "scanned".into(), message: "已扫码，请在手机上点击确认登录".into(), cookie: None },
        86038 => QrPollResult { state: "expired".into(), message: "二维码已过期，请重新生成".into(), cookie: None },
        _ => QrPollResult {
            state: "error".into(),
            message: if text.is_empty() { format!("扫码状态异常（{state_code}）") } else { text },
            cookie: None,
        },
    };
    Ok(result)
}

/// 从 Set-Cookie 与成功回调 URL 中提取凭证，只保留必要的键
pub fn cookies_from(headers: &HeaderMap, redirect_url: Option<&str>) -> String {
    let mut jar: BTreeMap<String, String> = BTreeMap::new();
    for raw in headers.get_all("set-cookie").iter() {
        if let Ok(line) = raw.to_str() {
            if let Some((k, v)) = line.split(';').next().unwrap_or("").split_once('=') {
                let key = k.trim().to_string();
                if !key.is_empty() && !v.trim().is_empty() {
                    jar.insert(key, v.trim().to_string());
                }
            }
        }
    }
    if let Some(url) = redirect_url {
        let query = url.split_once('?').map(|(_, q)| q).unwrap_or("");
        for pair in query.split('&') {
            if let Some((k, v)) = pair.split_once('=') {
                let key = k.trim().to_string();
                if matches!(key.as_str(), "SESSDATA" | "bili_jct" | "DedeUserID" | "DedeUserID__ckMd5" | "sid") {
                    jar.entry(key).or_insert_with(|| percent_decode(v));
                }
            }
        }
    }
    jar.into_iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("; ")
}

fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = &raw[i + 1..i + 3];
                if let Ok(v) = u8::from_str_radix(hex, 16) { out.push(v); i += 3; }
                else { out.push(bytes[i]); i += 1; }
            }
            b'+' => { out.push(b' '); i += 1; }
            b => { out.push(b); i += 1; }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

// ---- 登录态与 WBI ----

#[derive(Debug, Clone)]
pub struct Account {
    pub mid: String,
    pub uname: String,
    pub img_key: String,
    pub sub_key: String,
}

fn key_from_url(raw: &str) -> String {
    let file = raw.rsplit('/').next().unwrap_or("");
    file.split('.').next().unwrap_or("").to_string()
}

pub fn nav(cookie: &str) -> AppResult<Account> {
    let body: Value = client()?
        .get(NAV)
        .header(COOKIE, cookie)
        .header(REFERER, "https://www.bilibili.com/")
        .send()
        .map_err(|e| network_error("校验登录态失败，请检查网络", e))?
        .json()
        .map_err(|e| AppError::new("E_SYNC_API", format!("登录态响应无法解析：{e}")))?;
    let (code, message) = response_code(&body);
    if code != 0 { return Err(api_error(code, &message)); }
    let data = body.get("data").ok_or_else(|| AppError::new("E_SYNC_API", "登录态接口缺少 data"))?;
    if data.get("isLogin").and_then(|v| v.as_bool()) == Some(false) {
        return Err(AppError::new("E_SYNC_COOKIE", "登录态已失效，请重新扫码登录"));
    }
    let img = data.pointer("/wbi_img/img_url").and_then(|v| v.as_str()).unwrap_or("");
    let sub = data.pointer("/wbi_img/sub_url").and_then(|v| v.as_str()).unwrap_or("");
    let mid = match data.get("mid") {
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    };
    Ok(Account {
        mid,
        uname: data.get("uname").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        img_key: key_from_url(img),
        sub_key: key_from_url(sub),
    })
}

pub fn mixin_key(img: &str, sub: &str) -> String {
    let raw = format!("{img}{sub}");
    let chars: Vec<char> = raw.chars().collect();
    MIXIN_TAB.iter()
        .take(32)
        .filter_map(|&i| chars.get(i).copied())
        .collect()
}

fn encode_component(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for b in raw.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn md5_hex(raw: &str) -> String {
    let mut hasher = Md5::new();
    hasher.update(raw.as_bytes());
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// 返回可直接拼到 URL 后的完整查询串（含 wts 与 w_rid）
pub fn wbi_sign(params: &BTreeMap<String, String>, mixin: &str, wts: i64) -> String {
    let mut all = params.clone();
    all.insert("wts".to_string(), wts.to_string());
    let query = all.iter()
        .map(|(k, v)| {
            let clean: String = v.chars().filter(|c| !matches!(c, '!' | '\'' | '(' | ')' | '*')).collect();
            format!("{}={}", encode_component(k), encode_component(&clean))
        })
        .collect::<Vec<_>>()
        .join("&");
    format!("{query}&w_rid={}", md5_hex(&format!("{query}{mixin}")))
}

pub fn unix_seconds() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64
}

// ---- 大航海快照 ----

fn as_text(v: Option<&Value>) -> Option<String> {
    match v {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

fn as_i32(v: Option<&Value>) -> Option<i32> {
    match v {
        Some(Value::Number(n)) => n.as_i64().map(|x| x as i32),
        Some(Value::String(s)) => s.trim().parse::<i32>().ok(),
        _ => None,
    }
}

fn first_text(obj: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| as_text(obj.get(k)))
}

fn parse_member(obj: &Value) -> Option<GuardMember> {
    let uid = first_text(obj, &["uid", "mid", "userid", "userId"])?;
    if uid.trim().is_empty() { return None; }
    let guard_level = as_i32(obj.get("guard_level"))
        .or_else(|| as_i32(obj.get("guardLevel")))
        .or_else(|| as_i32(obj.get("level")))?;
    if !(1..=3).contains(&guard_level) { return None; }
    let nickname = first_text(obj, &["username", "uname", "nickname", "name"]).unwrap_or_else(|| uid.clone());
    let rank = as_i32(obj.get("rank")).or_else(|| as_i32(obj.get("rank_no")));
    Some(GuardMember { uid, nickname, guard_level, rank })
}

/// 兼容 list / top3 / info.list 等不同返回形状
pub fn collect_members(node: &Value, out: &mut Vec<GuardMember>) {
    match node {
        Value::Array(items) => {
            for item in items {
                if let Some(m) = parse_member(item) { out.push(m); }
                if let Some(nested) = item.get("list") { collect_members(nested, out); }
            }
        }
        Value::Object(map) => {
            if let Some(m) = parse_member(node) { out.push(m); }
            for (key, value) in map {
                if key == "list" || key == "top3" || key == "info" { collect_members(value, out); }
            }
        }
        _ => {}
    }
}

/// 唯一的在线同步源实现；Cookie 只保存在内存中的调用上下文，落盘由 sync::save_session 加密完成
pub struct BiliSource {
    pub cookie: String,
}

impl SyncSource for BiliSource {
    fn fetch_guard_snapshot(&self, room_id: &str) -> AppResult<Vec<GuardMember>> {
        fetch_guard_list(&self.cookie, room_id)
    }

    fn source_kind(&self) -> &'static str { "snapshot" }
}

pub fn fetch_guard_list(cookie: &str, room_id: &str) -> AppResult<Vec<GuardMember>> {
    let account = nav(cookie)?;
    let mixin = mixin_key(&account.img_key, &account.sub_key);
    let mut params = BTreeMap::new();
    params.insert("room_id".to_string(), room_id.to_string());
    params.insert("page".to_string(), "1".to_string());
    params.insert("page_size".to_string(), "100".to_string());
    let query = if mixin.len() == 32 {
        wbi_sign(&params, &mixin, unix_seconds())
    } else {
        // 缺少 WBI key 时降级为未签名请求；接口若拒绝会给出可读错误并建议手动导入
        params.insert("wts".to_string(), unix_seconds().to_string());
        params.iter().map(|(k, v)| format!("{}={}", encode_component(k), encode_component(v))).collect::<Vec<_>>().join("&")
    };
    let url = format!("{GUARD_LIST}?{query}");
    let body: Value = client()?
        .get(&url)
        .header(COOKIE, cookie)
        .header(REFERER, format!("https://live.bilibili.com/{room_id}"))
        .send()
        .map_err(|e| network_error("获取大航海名单失败，请检查网络", e))?
        .json()
        .map_err(|e| AppError::new("E_SYNC_API", format!("大航海名单响应无法解析：{e}")))?;
    let (code, message) = response_code(&body);
    if code != 0 { return Err(api_error(code, &message)); }
    let data = body.get("data").cloned().unwrap_or(Value::Null);
    let mut members = Vec::new();
    collect_members(&data, &mut members);
    let mut seen = std::collections::HashSet::new();
    members.retain(|m| seen.insert(m.uid.clone()));
    Ok(members)
}
