const extensionApi = typeof chrome !== "undefined" ? chrome : browser;

document.addEventListener("DOMContentLoaded", async () => {
    const connectedControls = document.getElementById("connectedControls");
    const loginMessage = document.getElementById("loginMessage");
    const loginForm = document.getElementById("loginForm");
    const loginError = document.getElementById("loginError");
    const logoutBtn = document.getElementById("logoutBtn");
    const checkbox = document.getElementById("enabledToggle");
    const refreshBtn = document.getElementById("refreshBtn");
    const statsDisplay = document.getElementById("statsDisplay");

    const tabs = await extensionApi.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]?.id) return;
    const tabId = tabs[0].id;

    function updateRefreshVisibility() {
        refreshBtn.parentElement.style.display = checkbox.checked ? "flex" : "none";
    }
	
	function createStatsRow(labelText, valueText) {
	  const row = document.createElement('div');
	  row.className = 'stats-row';

	  const label = document.createElement('div');
	  label.className = 'stats-label';
	  label.textContent = labelText;

	  const value = document.createElement('div');
	  value.className = 'stats-value';
	  value.textContent = valueText;

	  row.appendChild(label);
	  row.appendChild(value);

	  return row;
	}

	function updateStats(stats) {
		if (!stats || !stats.username) {
			statsDisplay.innerHTML = "Aucune statistique disponible.";
			return;
		}

		statsDisplay.textContent = '';
		statsDisplay.appendChild(createStatsRow('Utilisateur :', stats.username));
		statsDisplay.appendChild(createStatsRow('Webtoons suivis :', stats.total));
	}

    async function initPopup() {
        try {
            const login = await extensionApi.runtime.sendMessage({ action: "getUser" });

            if (login && login.loggedIn) {
                connectedControls.classList.remove("hidden");
                loginMessage.classList.add("hidden");

                const state = await extensionApi.runtime.sendMessage({ action: "getState", tabId });
                checkbox.checked = state?.enabled ?? false;

                updateRefreshVisibility();
                updateStats({
                    username: login.username,
                    total: login.total
                });

            } else {
                connectedControls.classList.add("hidden");
                loginMessage.classList.remove("hidden");
            }
        } catch(err) {
            console.error("[popup] erreur init:", err);
            connectedControls.classList.add("hidden");
            loginMessage.classList.remove("hidden");
        }
    }

    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        loginError.classList.add("hidden");

        const login = document.getElementById("login").value;
        const password = document.getElementById("password").value;

        try {
            const response = await extensionApi.runtime.sendMessage({
                action: "login",
                credentials: { login, password }
            });

            if (response && response.status === 200 && response.data?.token) {
                await extensionApi.storage.local.set({
                    jwtToken: response.data.token,
                    refreshToken: response.data.refresh_token || null
                });
                
                await initPopup();

                const state = await extensionApi.runtime.sendMessage({ action: "getState", tabId });
                if (state && state.enabled) {
                    await extensionApi.tabs.sendMessage(tabId, { action: "applyHighlight" });
                }

            } else {
                loginError.textContent = response?.data?.message || "Identifiants invalides.";
                loginError.classList.remove("hidden");
            }
        } catch(err) {
            console.error("[popup] Erreur /login:", err);
            loginError.textContent = "Erreur de connexion au serveur.";
            loginError.classList.remove("hidden");
        }
    });

    logoutBtn.addEventListener("click", async () => {
        await extensionApi.storage.local.remove(["jwtToken", "refreshToken"]);
        await extensionApi.tabs.sendMessage(tabId, { action: "removeHighlight" });
        await initPopup();
    });

    checkbox.addEventListener("change", async () => {
        const enabled = checkbox.checked;
        updateRefreshVisibility();

        try {
            await extensionApi.runtime.sendMessage({ action: "setState", tabId, enabled });
            const action = enabled ? "applyHighlight" : "removeHighlight";
            await extensionApi.tabs.sendMessage(tabId, { action });
        } catch(err) {
            console.error("[popup] erreur toggle:", err);
        }
    });

    refreshBtn.addEventListener("click", async () => {
        try {
            await extensionApi.tabs.sendMessage(tabId, { action: "removeHighlight" });
            setTimeout(async () => {
                await extensionApi.tabs.sendMessage(tabId, { action: "applyHighlight" });

                const login = await extensionApi.runtime.sendMessage({ action: "getUser" });
                if (login && login.loggedIn) {
                    updateStats({
                        username: login.username,
                        total: login.total
                    });
                }
            }, 50);
        } catch(err) {
            console.error("[popup] erreur refresh:", err);
        }
    });

    initPopup();
});
