// Compatibilité API Chrome
const extensionApi = typeof chrome !== "undefined" ? chrome : browser;

function escapeForRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fetchTitles() {
    try {
        const response = await extensionApi.runtime.sendMessage({ action: "getWebtoons" });
        if (!response || response.status !== 200) return [];

        const json = response.data;
        const data = Array.isArray(json) ? json : (json["hydra:member"] || json.data || []);

        return data
            .filter(w => w.userProgress && w.userProgress.bookmark != null)
            .map(item => ({
                title: String(item.title || "").trim(),
                rate: item.userProgress?.rate ?? null,
                bookmark: item.userProgress?.bookmark ?? null
            }))
            .sort((a, b) => b.title.length - a.title.length);
    } catch(err) {
        console.error("[content] fetchTitles error:", err);
        return [];
    }
}

function collectTextNodes(root=document.body){
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    const nodes = [];
    let node;
    while(node = walker.nextNode()){
        if(!node.nodeValue.trim()) continue;
        const tag = node.parentElement?.tagName;
        if(["SCRIPT","STYLE","NOSCRIPT"].includes(tag)) continue;
        nodes.push(node);
    }
    return nodes;
}

function highlight(titles) {
    if (!titles || titles.length === 0) return;

    const nodes = collectTextNodes();

    for (const node of nodes) {
        if (!node.parentNode) continue;
        let txt = node.nodeValue;
        if (!txt) continue;

        const frag = document.createDocumentFragment();
        let lastIndex = 0;
        const allMatches = [];
        const MIN_MATCH_CHARS = 25;

        for (const t of titles) {
            const normalizedTitle = String(t.title || "").trim();
            if (!normalizedTitle) continue;

            const fragment = normalizedTitle.length > MIN_MATCH_CHARS
                ? normalizedTitle.substring(0, MIN_MATCH_CHARS)
                : normalizedTitle;

            const rg = new RegExp(escapeForRegex(fragment), "gi");

            let match;
            while ((match = rg.exec(txt)) !== null) {
                allMatches.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    text: match[0],
                    rate: t.rate,
                    bookmark: t.bookmark,
                    normalizedTitle,
                    fragment,
                    fragmentLen: match[0].length,
                    partialMatch: fragment.length !== normalizedTitle.length
                });

                if (rg.lastIndex === match.index) rg.lastIndex++;
            }
        }

        if (allMatches.length === 0) continue;

        allMatches.sort((a, b) => a.start - b.start);

        let cursor = 0;
        for (const m of allMatches) {
            if (m.end <= cursor) continue;

            if (m.partialMatch && m.normalizedTitle) {
                const title = m.normalizedTitle;
                const fragLen = m.fragmentLen;
                let extend = 0;
                const maxExtend = Math.min(title.length - fragLen, txt.length - (m.start + fragLen));

                for (; extend < maxExtend; extend++) {
                    const pageChar = txt.charAt(m.start + fragLen + extend);
                    const titleChar = title.charAt(fragLen + extend);
                    if (pageChar.toLowerCase() !== titleChar.toLowerCase()) break;
                }

                m.end = m.start + fragLen + extend;
                m.text = txt.slice(m.start, m.end);
            } else {
                m.text = txt.slice(m.start, m.end);
            }

            if (m.end <= m.start) continue;

            if (m.start > lastIndex) {
                frag.appendChild(document.createTextNode(txt.slice(lastIndex, m.start)));
            }

            const highlightSpan = document.createElement('span');
            highlightSpan.className = 'webtoon-highlight';
            highlightSpan.textContent = m.text;
            highlightSpan.title = `${m.rate != null ? '⭐ ' + m.rate : ''} ${m.bookmark != null ? '📌 ' + m.bookmark : ''}`.trim();
            highlightSpan.style.background = '#a8e6a1';
            highlightSpan.style.color = 'black';
            highlightSpan.style.cursor = 'help';
            frag.appendChild(highlightSpan);

            const infoText = `${m.rate != null ? '⭐ ' + m.rate : ''} ${m.bookmark != null ? '📌 ' + m.bookmark : ''}`.trim();
            if (infoText) {
                const infoSpan = document.createElement('span');
                infoSpan.className = 'webtoon-info-ext';
                infoSpan.textContent = infoText;
                infoSpan.style.background = '#fff';
                infoSpan.style.borderRadius = '30px';
                infoSpan.style.padding = '2px 6px';
                infoSpan.style.marginLeft = '4px';
                infoSpan.style.fontSize = '16px';
                infoSpan.style.color = 'black';
                infoSpan.style.display = 'inline-block';
                frag.appendChild(infoSpan);
            }

            lastIndex = m.end;
            cursor = m.end;
        }

        if (lastIndex < txt.length) {
            frag.appendChild(document.createTextNode(txt.slice(lastIndex)));
        }

        node.parentNode.replaceChild(frag, node);
    }
}

function removeHighlight(){
    document.querySelectorAll(".webtoon-highlight").forEach(span=>{
        if(span.parentNode){
            const textNode = document.createTextNode(span.textContent);
            span.parentNode.replaceChild(textNode, span);
        }
    });
    document.querySelectorAll(".webtoon-info-ext").forEach(i => i.remove());
}

(async function init() {
    const login = await extensionApi.runtime.sendMessage({ action: "getUser" });

    if (!login || !login.loggedIn) return;

    const tabResponse = await extensionApi.runtime.sendMessage({ action: "getTabId" });
    const tabId = tabResponse?.tabId;
    const state = await extensionApi.runtime.sendMessage({ action: "getState", tabId });

    if (state && state.enabled) {
        const titles = await fetchTitles();
        highlight(titles);
    }
})();

extensionApi.runtime.onMessage.addListener(async msg => {
    if (msg.action === "applyHighlight") {
        const titles = await fetchTitles();
        highlight(titles);
    }
    if (msg.action === "removeHighlight") {
        removeHighlight();
    }
});
