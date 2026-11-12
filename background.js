importScripts("config.js");

const tabStates = {};

function stagingHeaders(headers) {
    if (typeof STAGING_AUTH !== "undefined" && STAGING_AUTH) {
        headers["X-Staging-Auth"] = `Basic ${btoa(STAGING_AUTH)}`;
    }
    return headers;
}

async function refreshJwtToken() {
    const { refreshToken } = await chrome.storage.local.get("refreshToken");
    if (!refreshToken) return null;

    try {
        const res = await fetch(`${API_BASE_URL}/token/refresh`, {
            method: "POST",
            headers: stagingHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ refresh_token: refreshToken })
        });

        if (!res.ok) return null;

        const data = await res.json();
        const newToken = data.token || data.jwtToken;
        const newRefreshToken = data.refresh_token || refreshToken;

        if (newToken) {
            await chrome.storage.local.set({
                jwtToken: newToken,
                refreshToken: newRefreshToken
            });
            return newToken;
        }
    } catch (err) {
        console.error("[background] Erreur refresh token:", err);
    }
    return null;
}

async function fetchWithAuth(url, options = {}) {
    let { jwtToken } = await chrome.storage.local.get("jwtToken");
    if (!jwtToken) return { ok: false, status: 401 };

    const headers = {
        ...options.headers,
        "Authorization": `Bearer ${jwtToken}`,
        "Accept": "application/json"
    };

    stagingHeaders(headers);

    options.headers = headers;

    let res = await fetch(url, options);

    if (res.status === 401) {
        const newToken = await refreshJwtToken();
        if (newToken) {
            options.headers["Authorization"] = `Bearer ${newToken}`;
            res = await fetch(url, options);
        } else {
            await chrome.storage.local.remove(["jwtToken", "refreshToken"]);
        }
    }

    return res;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const tabId = msg.tabId || sender.tab?.id;

    if (msg.action === "login") {
        (async () => {
            try {
                const headers = { 
                    "Content-Type": "application/json", 
                    "Accept": "application/json" 
                };
                stagingHeaders(headers);

                const res = await fetch(`${API_BASE_URL}/login`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({
                        login: msg.credentials.login,
                        password: msg.credentials.password
                    })
                });
                const data = await res.json();
                sendResponse({ status: res.status, data });
            } catch (err) {
                sendResponse({ status: 500, data: { message: err.message } });
            }
        })();
        return true;
    }

    if (msg.action === "getWebtoons") {
        (async () => {
            try {
                const res = await fetchWithAuth(`${API_BASE_URL}/webtoons?pagination=false`);
                if (!res.ok) {
                    sendResponse({ status: res.status, data: [] });
                    return;
                }
                const data = await res.json();
                sendResponse({ status: 200, data });
            } catch (err) {
                sendResponse({ status: 500, data: [], error: err.message });
            }
        })();
        return true;
    }

    if (msg.action === "getState") {
        if (!tabId) {
            sendResponse({ enabled: false });
        } else {
            if (!(tabId in tabStates)) tabStates[tabId] = false;
            sendResponse({ enabled: tabStates[tabId] });
        }
        return false;
    }

    if (msg.action === "setState") {
        if (tabId) tabStates[tabId] = msg.enabled;
        sendResponse({ success: Boolean(tabId) });
        return false;
    }

    if (msg.action === "getUser") {
        (async () => {
            try {
                const res = await fetchWithAuth(`${API_BASE_URL}/me`);
                if (!res.ok) {
                    sendResponse({ loggedIn: false });
                    return;
                }
                const json = await res.json();
                sendResponse({ 
                    loggedIn: true, 
                    username: json.username || json.email, 
                    total: json.total || 0 
                });
            } catch {
                sendResponse({ loggedIn: false });
            }
        })();
        return true;
    }

    if (msg.action === "getTabId") {
        sendResponse({ tabId });
        return false;
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabStates[tabId] !== undefined) {
        delete tabStates[tabId];
    }
});
