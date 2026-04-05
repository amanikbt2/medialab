
      let adminFeedbacks = [];
      let adminAnalytics = null;
      let adminUsageLogs = [];
      let adminPremiumRequests = [];
      let adminDownloads = [];
      let adminWithdrawals = [];
      let adminSocket = null;
      let adminCounterValues = {};
      let activeAdminTab = "analytics";
      let hasLoadedAdminData = false;
      let adminUnreadCounts = {
        feedbacks: 0,
        logs: 0,
        users: 0,
        premium: 0,
        downloads: 0,
        withdrawals: 0,
      };
      let feedbackView = "all";
      let feedbackFilters = {
        name: "",
        email: "",
        location: "",
        time: "",
      };
      let logFilters = {
        query: "",
      };
      const ADMIN_PASSWORD = "spiderman";
      const ADMIN_ACCESS_KEY = "medialab_admin_access";
      function showAdminToast(message, tone = "info") {
        const colors =
          tone === "error"
            ? "bg-rose-500/90 text-white"
            : tone === "success"
              ? "bg-emerald-500/90 text-slate-950"
              : "bg-cyan-500/90 text-slate-950";
        let node = document.getElementById("admin-toast");
        if (!node) {
          node = document.createElement("div");
          node.id = "admin-toast";
          node.className =
            "fixed right-4 top-4 z-[5000] rounded-2xl px-4 py-3 text-sm font-bold shadow-[0_24px_60px_rgba(2,6,23,0.45)]";
          document.body.appendChild(node);
        }
        node.className = `fixed right-4 top-4 z-[5000] rounded-2xl px-4 py-3 text-sm font-bold shadow-[0_24px_60px_rgba(2,6,23,0.45)] ${colors}`;
        node.textContent = message;
        node.classList.remove("hidden");
        clearTimeout(node._timer);
        node._timer = setTimeout(() => node.classList.add("hidden"), 2600);
      }
      function renderAdminTabBadges() {
        Object.entries(adminUnreadCounts).forEach(([tab, count]) => {
          const badge = document.getElementById(`badge-${tab}`);
          if (!badge) return;
          if (count > 0) {
            badge.textContent = count > 99 ? "99+" : String(count);
            badge.classList.remove("hidden");
          } else {
            badge.classList.add("hidden");
            badge.textContent = "";
          }
        });
      }
      function markAdminTabRead(name) {
        if (name in adminUnreadCounts) {
          adminUnreadCounts[name] = 0;
          renderAdminTabBadges();
        }
      }
      function bumpAdminUnread(name) {
        if (!(name in adminUnreadCounts) || activeAdminTab === name) return;
        adminUnreadCounts[name] += 1;
        renderAdminTabBadges();
      }

      function getAdminHeaders() {
        const password = localStorage.getItem(ADMIN_ACCESS_KEY) === "granted"
          ? "spiderman"
          : "";
        return password ? { "x-admin-password": password } : {};
      }

      function showAdminTab(name, button) {
        activeAdminTab = name;
        markAdminTabRead(name);
        document
          .querySelectorAll(".top-tab")
          .forEach((tab) => tab.classList.remove("active"));
        document
          .querySelectorAll(`.top-tab[data-tab="${name}"]`)
          .forEach((tab) => tab.classList.add("active"));
        ["analytics", "feedbacks", "logs", "users", "premium", "downloads", "withdrawals"].forEach((tabName) => {
          document
            .getElementById(`tab-${tabName}`)
            ?.classList.toggle("hidden", tabName !== name);
        });
        if (name === "logs") {
          requestAnimationFrame(() => {
            document
              .querySelectorAll("#tab-logs .terminal-body")
              .forEach((node) => {
                node.scrollTop = node.scrollHeight;
              });
          });
        }
      }

      function formatDate(value) {
        return value ? new Date(value).toLocaleString() : "Unknown";
      }

      function escapeHtml(value) {
        return String(value || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function formatLogIdentity(item) {
        if (item.isAnonymous) return "anonymous";
        const email = (item.email || "unknown").trim();
        const name = (item.name || "unknown").trim();
        return `${name}#${email}`;
      }

      function formatLogSummary(item) {
        return item.summary || item.action || "activity";
      }

      function updateLogFilter(value) {
        logFilters.query = String(value || "");
        renderLogs();
      }

      function captureLogFilterFocus() {
        const active = document.activeElement;
        if (!active || active.tagName !== "INPUT") return null;
        const key = active.getAttribute("data-log-filter");
        if (!key) return null;
        return {
          key,
          start: active.selectionStart ?? String(active.value || "").length,
          end: active.selectionEnd ?? String(active.value || "").length,
        };
      }

      function restoreLogFilterFocus(state) {
        if (!state) return;
        requestAnimationFrame(() => {
          const input = document.querySelector(
            `[data-log-filter="${state.key}"]`,
          );
          if (!input) return;
          input.focus({ preventScroll: true });
          if (typeof input.setSelectionRange === "function") {
            input.setSelectionRange(state.start, state.end);
          }
        });
      }

      function getLogSearchFields(item) {
        const action = String(item.action || "").toLowerCase();
        const summary = String(item.summary || "").toLowerCase();
        const source = String(
          item.source || item.metadata?.toolType || item.metadata?.toolId || "",
        ).toLowerCase();
        const metadataText = JSON.stringify(item.metadata || {}).toLowerCase();
        const created = formatDate(item.createdAt).toLowerCase();
        const name = String(item.name || "").toLowerCase();
        const email = String(item.email || "").toLowerCase();
        const location = String(item.location || item.metadata?.location || "").toLowerCase();
        const ip = String(item.ip || item.metadata?.ip || "").toLowerCase();
        const activity = [action, summary, source, metadataText].filter(Boolean).join(" ");
        const full = [
          name,
          email,
          source,
          action,
          summary,
          created,
          location,
          ip,
          metadataText,
        ]
          .filter(Boolean)
          .join(" ");
        return {
          username: name,
          name,
          user: name,
          email,
          activity,
          action,
          summary,
          tool: source,
          source,
          date: created,
          time: created,
          location,
          ip,
          text: full,
          any: full,
          full,
        };
      }

      function splitSmartQuery(query, operator) {
        return String(query || "")
          .split(new RegExp(`\\s+${operator}\\s+`, "i"))
          .map((part) => part.trim())
          .filter(Boolean);
      }

      const SMART_LOG_FIELDS = [
        "username",
        "name",
        "user",
        "email",
        "activity",
        "action",
        "summary",
        "tool",
        "source",
        "date",
        "time",
        "location",
        "ip",
        "text",
        "any",
      ];

      function parseSmartLogClause(clause) {
        const normalized = String(clause || "").trim();
        if (!normalized) return null;
        const match = normalized.match(
          /^(username|name|user|email|activity|action|summary|tool|source|date|time|location|ip|text|any)\s*(=|:|~)\s*(.+)$/i,
        );
        if (match) {
          return {
            field: match[1].toLowerCase(),
            value: match[3].trim().replace(/^["']|["']$/g, "").toLowerCase(),
          };
        }
        return {
          field: "full",
          value: normalized.replace(/^["']|["']$/g, "").toLowerCase(),
        };
      }
      function analyzeSmartLogClause(clause) {
        const normalized = String(clause || "").trim();
        if (!normalized) {
          return { status: "empty", message: "Type a query to filter logs." };
        }
        const parsed = parseSmartLogClause(normalized);
        if (parsed?.field !== "full") {
          return parsed.value
            ? { status: "valid", message: `Filtering by ${parsed.field}.` }
            : {
                status: "partial",
                message: `Add a value after ${parsed.field}= to finish this filter.`,
              };
        }
        const partialFieldMatch = normalized.match(/^([a-z]+)\s*(=|:|~)?\s*$/i);
        if (partialFieldMatch) {
          const fragment = partialFieldMatch[1].toLowerCase();
          const suggestions = SMART_LOG_FIELDS.filter((field) =>
            field.startsWith(fragment),
          ).slice(0, 3);
          if (suggestions.length) {
            return {
              status: "partial",
              message: `Smart query ready. Try ${suggestions
                .map((field) => `${field}=...`)
                .join(", ")}.`,
            };
          }
        }
        return {
          status: "valid",
          message: "Searching logs with flexible text matching.",
        };
      }
      function analyzeSmartLogQuery(query) {
        const trimmedQuery = String(query || "").trim();
        if (!trimmedQuery) {
          return { status: "empty", message: "Use smart filters or plain text search." };
        }
        const orGroups = splitSmartQuery(trimmedQuery, "or");
        const clauseStatuses = orGroups.flatMap((group) =>
          splitSmartQuery(group, "and").map((clause) => analyzeSmartLogClause(clause)),
        );
        if (clauseStatuses.some((item) => item.status === "partial")) {
          return clauseStatuses.find((item) => item.status === "partial");
        }
        return clauseStatuses.find((item) => item.status === "valid") || {
          status: "valid",
          message: "Searching logs.",
        };
      }

      function matchesSmartLogClause(item, clause) {
        const parsed = parseSmartLogClause(clause);
        if (!parsed || !parsed.value) return true;
        const fields = getLogSearchFields(item);
        const haystack = String(fields[parsed.field] || fields.full || "").toLowerCase();
        return haystack.includes(parsed.value);
      }

      function matchesSmartLogQuery(item, query) {
        const trimmedQuery = String(query || "").trim();
        if (!trimmedQuery) return true;
        const orGroups = splitSmartQuery(trimmedQuery, "or");
        return orGroups.some((group) => {
          const andClauses = splitSmartQuery(group, "and");
          return andClauses.every((clause) => matchesSmartLogClause(item, clause));
        });
      }

      function getFilteredLogs() {
        return adminUsageLogs.filter((item) =>
          matchesSmartLogQuery(item, logFilters.query),
        );
      }

      function animateCountValue(target, nextValue) {
        const finalValue = Number(nextValue || 0);
        const startValue = Number(target.dataset.currentValue || 0);
        if (startValue === finalValue) {
          target.textContent = finalValue.toLocaleString();
          target.dataset.currentValue = String(finalValue);
          return;
        }
        const duration = 900;
        const startTime = performance.now();
        function step(now) {
          const progress = Math.min((now - startTime) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          const current = Math.round(
            startValue + (finalValue - startValue) * eased,
          );
          target.textContent = current.toLocaleString();
          if (progress < 1) {
            requestAnimationFrame(step);
          } else {
            target.dataset.currentValue = String(finalValue);
          }
        }
        requestAnimationFrame(step);
      }

      function animateAnalyticsCounts() {
        document.querySelectorAll("[data-count-value]").forEach((node) => {
          const key = node.dataset.countKey || "";
          const nextValue = Number(node.dataset.countValue || 0);
          const previousValue = Number(node.dataset.currentValue || nextValue);
          if (previousValue === nextValue) {
            node.textContent = nextValue.toLocaleString();
            node.dataset.currentValue = String(nextValue);
          } else {
            animateCountValue(node, nextValue);
          }
          if (key) adminCounterValues[key] = nextValue;
        });
      }

      function setLiveStatus(connected) {
        const dot = document.getElementById("live-update-dot");
        const label = document.getElementById("live-update-label");
        dot?.classList.toggle("offline", !connected);
        if (label) {
          label.textContent = connected ? "Connected" : "Reconnecting";
        }
      }

      function unlockAdmin() {
        const field = document.getElementById("admin-password");
        const error = document.getElementById("admin-auth-error");
        const password = field?.value?.trim() || "";
        if (password !== ADMIN_PASSWORD) {
          error?.classList.remove("hidden");
          field?.focus();
          return;
        }
        localStorage.setItem(ADMIN_ACCESS_KEY, "granted");
        document.getElementById("admin-auth-overlay")?.classList.add("hidden");
        error?.classList.add("hidden");
        loadAdminData();
      }

      function ensureAdminAccess() {
        const unlocked = localStorage.getItem(ADMIN_ACCESS_KEY) === "granted";
        document
          .getElementById("admin-auth-overlay")
          ?.classList.toggle("hidden", unlocked);
        if (unlocked) loadAdminData();
      }

      function toggleFeedbackRow(id) {
        document.getElementById(`feedback-row-${id}`)?.classList.toggle("open");
      }

      function togglePremiumRow(id) {
        document.getElementById(`premium-row-${id}`)?.classList.toggle("open");
      }

      function setFeedbackView(view) {
        feedbackView = view;
        renderFeedbacks();
      }

      function updateFeedbackFilter(key, value) {
        const activeInput = document.activeElement;
        const selectionStart =
          activeInput && typeof activeInput.selectionStart === "number"
            ? activeInput.selectionStart
            : null;
        const selectionEnd =
          activeInput && typeof activeInput.selectionEnd === "number"
            ? activeInput.selectionEnd
            : null;
        const activeKey = activeInput?.dataset?.feedbackFilter || "";
        feedbackFilters[key] = String(value || "")
          .trim()
          .toLowerCase();
        renderFeedbacks();
        requestAnimationFrame(() => {
          const nextInput = document.querySelector(
            `[data-feedback-filter="${activeKey || key}"]`,
          );
          if (nextInput) {
            nextInput.focus();
            if (
              typeof selectionStart === "number" &&
              typeof selectionEnd === "number"
            ) {
              nextInput.setSelectionRange(selectionStart, selectionEnd);
            }
          }
        });
      }

      function openClearLogsModal() {
        document.getElementById("clear-logs-modal")?.classList.remove("hidden");
        document.getElementById("clear-logs-modal")?.classList.add("flex");
      }

      function closeClearLogsModal() {
        document.getElementById("clear-logs-modal")?.classList.add("hidden");
        document.getElementById("clear-logs-modal")?.classList.remove("flex");
      }

      async function clearUsageLogs() {
        const btn = document.getElementById("clear-logs-confirm-btn");
        if (btn) {
          btn.disabled = true;
          btn.textContent = "Clearing...";
        }
        try {
          const res = await fetch("/api/admin/usage-logs", {
            method: "DELETE",
            headers: getAdminHeaders(),
          });
          const data = await res.json();
          if (!data.success)
            throw new Error(data.message || "Could not clear logs.");
          adminUsageLogs = [];
          if (adminAnalytics) {
            adminAnalytics.totalUsageLogs = 0;
            adminAnalytics.recentErrors = 0;
            if (adminAnalytics.last30Days) {
              adminAnalytics.last30Days.usageLogs = 0;
              adminAnalytics.last30Days.errors = 0;
            }
          }
          renderAnalyticsDetails();
          renderLogs();
          closeClearLogsModal();
        } catch (error) {
          showAdminToast(error.message || "Could not clear logs.", "error");
        } finally {
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Clear Logs";
          }
        }
      }

      function getFilteredFeedbacks() {
        return adminFeedbacks.filter((item) => {
          if (feedbackView === "flagged" && !item.hidden) return false;
          const nameText = String(
            item.username || item.name || "anonymous",
          ).toLowerCase();
          const emailText = String(item.email || "").toLowerCase();
          const locationText = String(
            item.location || item.country || item.region || "",
          ).toLowerCase();
          const timeText = formatDate(item.createdAt).toLowerCase();
          if (feedbackFilters.name && !nameText.includes(feedbackFilters.name))
            return false;
          if (
            feedbackFilters.email &&
            !emailText.includes(feedbackFilters.email)
          )
            return false;
          if (
            feedbackFilters.location &&
            !locationText.includes(feedbackFilters.location)
          )
            return false;
          if (feedbackFilters.time && !timeText.includes(feedbackFilters.time))
            return false;
          return true;
        });
      }

      function toggleAudienceRow(id) {
        document.getElementById(`audience-row-${id}`)?.classList.toggle("open");
      }

      function toggleTerminalPane(id) {
        document.getElementById(id)?.classList.toggle("collapsed");
      }

      function renderAnalyticsDetails() {
        const el = document.getElementById("tab-analytics");
        if (!el || !adminAnalytics) return;
        const cards = [
          ["users", "Users", adminAnalytics.totalUsers || 0],
          ["proUsers", "Pro Users", adminAnalytics.proUsers || 0],
          ["feedbacks", "Feedbacks", adminAnalytics.totalFeedbacks || 0],
          ["premiumRequests", "Premium Requests", adminAnalytics.totalUpgradeRequests || 0],
          ["downloads", "Downloads", adminAnalytics.totalDownloads || 0],
          ["withdrawals", "Withdrawals", adminAnalytics.totalWithdrawals || 0],
          ["usageLogs", "Usage Logs", adminAnalytics.totalUsageLogs || 0],
        ];
        el.innerHTML = `
          <div class="grid grid-cols-2 xl:grid-cols-7 gap-3 sm:gap-4">
            ${cards
              .map(
                ([key, label, value]) => `
              <div class="glass border border-white/10 rounded-[1.3rem] sm:rounded-[1.5rem] p-4 sm:p-5">
                <div class="text-[11px] uppercase tracking-[0.22em] text-slate-400 font-bold">${label}</div>
                <div data-count-key="${key}" data-count-value="${value}" data-current-value="${adminCounterValues[key] ?? value}" class="text-2xl sm:text-3xl font-bold mt-3">${Number(adminCounterValues[key] ?? value).toLocaleString()}</div>
              </div>
            `,
              )
              .join("")}
          </div>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div class="glass border border-white/10 rounded-[1.5rem] p-5">
              <div class="text-[11px] uppercase tracking-[0.22em] text-slate-400 font-bold">Feedback Summary</div>
              <div class="space-y-3 mt-4 text-sm">
                <div class="flex items-center justify-between"><span class="text-slate-300">Open</span><strong>${adminAnalytics.openFeedbacks || 0}</strong></div>
                <div class="flex items-center justify-between"><span class="text-slate-300">Completed</span><strong>${adminAnalytics.completedFeedbacks || 0}</strong></div>
                <div class="flex items-center justify-between"><span class="text-slate-300">Flagged</span><strong>${adminAnalytics.hiddenFeedbacks || 0}</strong></div>
              </div>
            </div>
            <div class="glass border border-white/10 rounded-[1.5rem] p-5">
              <div class="text-[11px] uppercase tracking-[0.22em] text-slate-400 font-bold">Premium Summary</div>
              <div class="space-y-3 mt-4 text-sm">
                <div class="flex items-center justify-between"><span class="text-slate-300">Total users</span><strong>${adminAnalytics.totalUsers || 0}</strong></div>
                <div class="flex items-center justify-between"><span class="text-slate-300">Pro users</span><strong>${adminAnalytics.proUsers || 0}</strong></div>
                <div class="flex items-center justify-between"><span class="text-slate-300">Premium requests</span><strong>${adminAnalytics.totalUpgradeRequests || 0}</strong></div>
                <div class="flex items-center justify-between"><span class="text-slate-300">Pending review</span><strong>${adminAnalytics.pendingUpgradeRequests || 0}</strong></div>
              </div>
            </div>
            <div class="glass border border-white/10 rounded-[1.5rem] p-5">
              <div class="text-[11px] uppercase tracking-[0.22em] text-slate-400 font-bold">Payout Summary</div>
              <div class="space-y-3 mt-4 text-sm">
                <div class="flex items-center justify-between"><span class="text-slate-300">All requests</span><strong>${adminAnalytics.totalWithdrawals || 0}</strong></div>
                <div class="flex items-center justify-between"><span class="text-slate-300">Pending</span><strong>${adminAnalytics.pendingWithdrawals || 0}</strong></div>
                <div class="flex items-center justify-between"><span class="text-slate-300">Paid</span><strong>${adminAnalytics.paidWithdrawals || 0}</strong></div>
              </div>
            </div>
          </div>
          <div class="glass border border-white/10 rounded-[1.5rem] p-5">
            <div class="flex items-center justify-between gap-3">
              <div class="text-[11px] uppercase tracking-[0.22em] text-slate-400 font-bold">Last 30 Days</div>
              <div class="text-xs text-slate-500">Rolling summary</div>
            </div>
            <div class="grid grid-cols-2 lg:grid-cols-6 gap-3 mt-4">
              <div class="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-4">
                <div class="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-bold">New Signups</div>
                <div class="text-xl font-bold mt-2">${adminAnalytics.last30Days?.newUsers || 0}</div>
              </div>
              <div class="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-4">
                <div class="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-bold">New Pro</div>
                <div class="text-xl font-bold mt-2">${adminAnalytics.last30Days?.newProUsers || 0}</div>
              </div>
              <div class="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-4">
                <div class="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-bold">Feedbacks</div>
                <div class="text-xl font-bold mt-2">${adminAnalytics.last30Days?.feedbacks || 0}</div>
              </div>
              <div class="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-4">
                <div class="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-bold">Logs</div>
                <div class="text-xl font-bold mt-2">${adminAnalytics.last30Days?.usageLogs || 0}</div>
              </div>
              <div class="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-4">
                <div class="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-bold">Downloads</div>
                <div class="text-xl font-bold mt-2">${adminAnalytics.last30Days?.downloads || 0}</div>
              </div>
              <div class="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-4">
                <div class="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-bold">Errors</div>
                <div class="text-xl font-bold mt-2">${adminAnalytics.last30Days?.errors || 0}</div>
              </div>
              <div class="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-4">
                <div class="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-bold">Withdrawals</div>
                <div class="text-xl font-bold mt-2">${adminAnalytics.last30Days?.withdrawals || 0}</div>
              </div>
              <div class="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-4">
                <div class="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-bold">Upgrade Requests</div>
                <div class="text-xl font-bold mt-2">${adminAnalytics.last30Days?.upgradeRequests || 0}</div>
              </div>
            </div>
          </div>
        `;
        requestAnimationFrame(() => animateAnalyticsCounts());
      }

      function renderPremiumRequests() {
        const el = document.getElementById("tab-premium");
        if (!el) return;
        if (!adminPremiumRequests.length) {
          el.innerHTML = `<div class="rounded-[1.5rem] border border-dashed border-white/10 p-8 text-center text-slate-400">No premium requests yet.</div>`;
          return;
        }
        el.innerHTML = adminPremiumRequests
          .map((item) => {
            const statusTone =
              item.status === "granted"
                ? "bg-emerald-500/15 text-emerald-300"
                : item.status === "denied"
                  ? "bg-rose-500/15 text-rose-300"
                  : "bg-amber-500/15 text-amber-300";
            return `
          <article id="premium-row-${item._id}" class="premium-row glass border border-white/10 rounded-[1.35rem] overflow-hidden">
            <button onclick="togglePremiumRow('${item._id}')" class="w-full text-left px-4 py-4 sm:px-5 hover:bg-white/[0.03] transition-all">
              <div class="flex items-start gap-3">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3 class="text-base sm:text-lg font-bold text-white">${escapeHtml(item.name || "Unknown User")}</h3>
                    <span class="px-2.5 py-1 rounded-full ${statusTone} text-[10px] font-bold uppercase tracking-[0.16em]">${escapeHtml(item.status || "pending")}</span>
                  </div>
                  <div class="mt-2 text-sm text-slate-400 break-all">${escapeHtml(item.email || "No email")}</div>
                  <div class="mt-2 text-xs text-slate-500">Requested ${escapeHtml(formatDate(item.createdAt))}</div>
                </div>
                <svg class="premium-chevron mt-1.5 h-4 w-4 text-slate-500 transition-transform" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 011.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"></path></svg>
              </div>
            </button>
            <div class="premium-detail border-t border-white/6 px-4 py-4 sm:px-5 sm:py-5 bg-slate-950/35">
              <div class="mt-0 space-y-1 text-sm text-slate-300">
                  <div><span class="text-slate-500">Feature:</span> ${escapeHtml(item.requestedFeature || "MediaLab Pro")}</div>
                  <div><span class="text-slate-500">Source:</span> ${escapeHtml(item.source || "studio")}</div>
                  <div><span class="text-slate-500">Requested:</span> ${escapeHtml(formatDate(item.createdAt))}</div>
                  <div><span class="text-slate-500">Message:</span> ${escapeHtml(item.message || "Request premium join.")}</div>
                </div>
              <div class="flex flex-wrap gap-2 mt-4">
                <button onclick="updatePremiumRequest('${item._id}', 'granted')" class="px-3.5 py-2 rounded-xl bg-emerald-400 text-slate-950 text-xs sm:text-sm font-bold hover:bg-emerald-300 transition-all">Grant</button>
                <button onclick="updatePremiumRequest('${item._id}', 'denied')" class="px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-200 text-xs sm:text-sm font-bold hover:bg-white/10 transition-all">Request Denied</button>
              </div>
            </div> 
          </article>
        `;
          })
          .join("");
      }

      function renderDownloads() {
        const el = document.getElementById("tab-downloads");
        if (!el) return;
        if (!adminDownloads.length) {
          el.innerHTML = `<div class="rounded-[1.5rem] border border-dashed border-white/10 p-8 text-center text-slate-400">No downloads recorded yet.</div>`;
          return;
        }
        el.innerHTML = adminDownloads
          .map(
            (item) => `
          <article class="rounded-[1.35rem] border border-white/10 bg-white/[0.03] overflow-hidden">
            <div class="px-4 py-4 sm:px-5 sm:py-5">
              <div class="flex items-center gap-4">
                <div class="w-11 h-11 rounded-full border border-cyan-400/25 bg-cyan-500/10 text-cyan-300 flex items-center justify-center shrink-0">
                  <i class="fas fa-download text-sm"></i>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3 class="text-sm sm:text-base font-bold text-white">${escapeHtml(item.name || "Anonymous")}</h3>
                    <span class="px-2.5 py-1 rounded-full ${item.isAnonymous ? "bg-white/5 text-slate-300" : "bg-emerald-500/15 text-emerald-300"} text-[10px] font-bold uppercase tracking-[0.16em]">${item.isAnonymous ? "Guest" : "User"}</span>
                    <span class="px-2.5 py-1 rounded-full bg-cyan-500/15 text-cyan-300 text-[10px] font-bold uppercase tracking-[0.16em]">${escapeHtml(item.type || "pwa")}</span>
                  </div>
                  <div class="mt-2 text-xs sm:text-sm text-slate-400 break-all">${escapeHtml(item.email || "No email")}</div>
                </div>
              </div>
              <div class="mt-4 space-y-2 text-sm sm:text-[15px]">
                <div class="text-slate-300"><span class="text-slate-500">Platform:</span> ${escapeHtml(item.platform || "Unknown")}</div>
                <div class="text-slate-300"><span class="text-slate-500">Source:</span> ${escapeHtml(item.source || "web")}</div>
                <div class="text-slate-300"><span class="text-slate-500">Downloaded:</span> ${formatDate(item.createdAt)}</div>
              </div>
            </div>
          </article>
        `,
          )
          .join("");
      }

      function renderWithdrawals() {
        const el = document.getElementById("tab-withdrawals");
        if (!el) return;
        if (!adminWithdrawals.length) {
          el.innerHTML = `<div class="rounded-[1.5rem] border border-dashed border-white/10 p-8 text-center text-slate-400">No withdrawal requests yet.</div>`;
          return;
        }
        el.innerHTML = adminWithdrawals
          .map(
            (item) => {
              const tone =
                item.status === "paid"
                  ? "bg-emerald-500/15 text-emerald-300"
                  : item.status === "failed"
                    ? "bg-rose-500/15 text-rose-300"
                    : item.status === "processing"
                      ? "bg-amber-500/15 text-amber-300"
                      : "bg-cyan-500/15 text-cyan-300";
              return `
          <article class="rounded-[1.35rem] border border-white/10 bg-white/[0.03] overflow-hidden">
            <div class="px-4 py-4 sm:px-5 sm:py-5">
              <div class="flex items-start gap-4">
                <div class="w-11 h-11 rounded-full border border-emerald-400/25 bg-emerald-500/10 text-emerald-300 flex items-center justify-center shrink-0">
                  <i class="fas fa-money-bill-wave text-sm"></i>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3 class="text-sm sm:text-base font-bold text-white">${escapeHtml(item.name || "Unknown User")}</h3>
                    <span class="px-2.5 py-1 rounded-full ${tone} text-[10px] font-bold uppercase tracking-[0.16em]">${escapeHtml(item.status || "pending")}</span>
                  </div>
                  <div class="mt-2 text-xs sm:text-sm text-slate-400 break-all">${escapeHtml(item.email || "No email")}</div>
                  <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-slate-300">
                    <div><span class="text-slate-500">Amount:</span> $${Number(item.amount || 0).toFixed(2)}</div>
                    <div><span class="text-slate-500">Method:</span> ${escapeHtml(item.method || "Unknown")}</div>
                    <div><span class="text-slate-500">Destination:</span> ${escapeHtml(item.destination || "Not set")}</div>
                    <div><span class="text-slate-500">Requested:</span> ${formatDate(item.createdAt)}</div>
                  </div>
                  <div class="mt-4 flex flex-wrap gap-2">
                    <button onclick="updateWithdrawalStatus('${item._id}', 'processing')" class="px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-200 text-xs sm:text-sm font-bold hover:bg-white/10 transition-all">Processing</button>
                    <button onclick="updateWithdrawalStatus('${item._id}', 'paid')" class="px-3.5 py-2 rounded-xl bg-emerald-400 text-slate-950 text-xs sm:text-sm font-bold hover:bg-emerald-300 transition-all">Paid</button>
                    <button onclick="updateWithdrawalStatus('${item._id}', 'failed')" class="px-3.5 py-2 rounded-xl bg-rose-500/90 text-white text-xs sm:text-sm font-bold hover:bg-rose-400 transition-all">Failed / Refund</button>
                  </div>
                </div>
              </div>
            </div>
          </article>`;
            },
          )
          .join("");
      }

      function renderFeedbacks() {
        const el = document.getElementById("tab-feedbacks");
        if (!el) return;
        if (!adminFeedbacks.length) {
          el.innerHTML = `<div class="rounded-[1.5rem] border border-dashed border-white/10 p-8 text-center text-slate-400">No feedback saved yet.</div>`;
          return;
        }
        const filteredFeedbacks = getFilteredFeedbacks();
        el.innerHTML = `
          <div class="glass border border-white/10 rounded-[1.4rem] p-4 sm:p-5 space-y-4">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div class="flex gap-2 overflow-x-auto hide-scrollbar">
                <button onclick="setFeedbackView('all')" class="mini-tab ${feedbackView === "all" ? "active" : ""} px-4 py-2 rounded-2xl text-xs font-bold uppercase tracking-[0.16em]">All Feedbacks</button>
                <button onclick="setFeedbackView('flagged')" class="mini-tab ${feedbackView === "flagged" ? "active" : ""} px-4 py-2 rounded-2xl text-xs font-bold uppercase tracking-[0.16em]">Flagged</button>
                <button onclick="setFeedbackView('filter')" class="mini-tab ${feedbackView === "filter" ? "active" : ""} px-4 py-2 rounded-2xl text-xs font-bold uppercase tracking-[0.16em]">Filter</button>
              </div>
              <div class="text-xs text-slate-400">${filteredFeedbacks.length} result${filteredFeedbacks.length === 1 ? "" : "s"}</div>
            </div>
            <div class="${feedbackView === "filter" ? "grid" : "hidden"} grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <input data-feedback-filter="name" value="${escapeHtml(feedbackFilters.name)}" oninput="updateFeedbackFilter('name', this.value)" placeholder="Filter by name" class="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400" />
              <input data-feedback-filter="email" value="${escapeHtml(feedbackFilters.email)}" oninput="updateFeedbackFilter('email', this.value)" placeholder="Filter by email" class="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400" />
              <input data-feedback-filter="location" value="${escapeHtml(feedbackFilters.location)}" oninput="updateFeedbackFilter('location', this.value)" placeholder="Filter by location" class="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400" />
              <input data-feedback-filter="time" value="${escapeHtml(feedbackFilters.time)}" oninput="updateFeedbackFilter('time', this.value)" placeholder="Filter by time" class="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400" />
            </div>
          </div>
          ${
            filteredFeedbacks.length
              ? filteredFeedbacks
                  .map(
                    (item) => `
          <article id="feedback-row-${item._id}" class="feedback-row rounded-[1.35rem] border border-white/10 bg-white/[0.03] overflow-hidden">
            <button onclick="toggleFeedbackRow('${item._id}')" class="w-full text-left px-4 py-4 sm:px-5 hover:bg-white/[0.03] transition-all">
              <div class="flex items-start gap-3">
                <div class="mt-1 w-2.5 h-2.5 rounded-full ${item.status === "completed" ? "bg-emerald-400" : "bg-cyan-400"} shrink-0"></div>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3 class="text-sm sm:text-base font-bold text-white">${item.username || "Anonymous"}</h3>
                    <span class="px-2.5 py-1 rounded-full bg-white/5 text-slate-300 text-[10px] font-bold uppercase tracking-[0.16em]">${item.rating}/5</span>
                    <span class="px-2.5 py-1 rounded-full ${item.status === "completed" ? "bg-emerald-500/15 text-emerald-300" : "bg-cyan-500/15 text-cyan-300"} text-[10px] font-bold uppercase tracking-[0.16em]">${item.status || "open"}</span>
                    <span class="px-2.5 py-1 rounded-full ${item.hidden ? "bg-amber-500/15 text-amber-300" : "bg-white/5 text-slate-400"} text-[10px] font-bold uppercase tracking-[0.16em]">${item.hidden ? "flagged" : "visible"}</span>
                  </div>
                  <p class="text-xs sm:text-sm text-slate-400 mt-1">${item.email || "Anonymous"} | ${formatDate(item.createdAt)}</p>
                </div>
                <svg class="feedback-chevron mt-1.5 h-4 w-4 text-slate-500 transition-transform" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 011.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"></path></svg>
              </div>
            </button>
            <div class="feedback-detail border-t border-white/6 px-4 py-4 sm:px-5 sm:py-5 bg-slate-950/35">
              <p class="text-sm sm:text-base text-slate-200 leading-relaxed">${item.feedback}</p>
              <div class="mt-3 space-y-1 text-xs sm:text-sm text-slate-400">
                <div>Name: ${item.username || "Anonymous"}</div>
                <div>Email: ${item.email || "Anonymous"}</div>
                <div>Location: ${item.location || item.country || item.region || "Not available"}</div>
                <div>Time: ${formatDate(item.createdAt)}</div>
              </div>
              <div class="flex flex-wrap gap-2 mt-4">
                <button onclick="updateFeedback('${item._id}', { status: '${item.status === "completed" ? "open" : "completed"}' })" class="px-3.5 py-2 rounded-xl bg-cyan-400 text-slate-950 text-xs sm:text-sm font-bold hover:bg-cyan-300 transition-all">${item.status === "completed" ? "Reopen" : "Complete"}</button>
                <button onclick="updateFeedback('${item._id}', { hidden: ${item.hidden ? "false" : "true"} })" class="px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-200 text-xs sm:text-sm font-bold hover:bg-white/10 transition-all">${item.hidden ? "Unflag" : "Flag"}</button>
              </div>
            </div>
          </article>
        `,
                  )
                  .join("")
              : `<div class="rounded-[1.5rem] border border-dashed border-white/10 p-8 text-center text-slate-400">No feedback matches this view.</div>`
          }
        `;
      }

      function renderUsers() {
        const el = document.getElementById("tab-users");
        if (!el || !adminAnalytics) return;
        const users = adminAnalytics.recentUsers || [];
        if (!users.length) {
          el.innerHTML = `<div class="rounded-[1.5rem] border border-dashed border-white/10 p-8 text-center text-slate-400">No users found yet.</div>`;
          return;
        }
        el.innerHTML = users
          .map(
            (user) => `
          <article id="audience-row-${user._id}" class="audience-row rounded-[1.35rem] border border-white/10 bg-white/[0.03] overflow-hidden">
            <button onclick="toggleAudienceRow('${user._id}')" class="w-full px-4 py-4 sm:px-5 text-left hover:bg-white/[0.03] transition-all">
              <div class="flex items-center gap-4">
                <img src="${user.profilePicture || "https://via.placeholder.com/40/0f172a/e2e8f0?text=U"}" alt="${escapeHtml(user.name || "User")}" class="w-11 h-11 rounded-full object-cover border border-white/10 bg-slate-900 shrink-0" />
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3 class="text-sm sm:text-base font-bold text-white">${user.name || "Unknown User"}</h3>
                    <span class="px-2.5 py-1 rounded-full ${user.isPro ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-slate-300"} text-[10px] font-bold uppercase tracking-[0.16em]">${user.isPro ? "Pro" : "Free"}</span>
                  </div>
                  <p class="text-xs sm:text-sm text-slate-400 mt-1 break-all">${user.email || "No email"}</p>
                </div>
                <svg class="audience-chevron h-4 w-4 text-slate-500 transition-transform" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 011.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"></path></svg>
              </div>
            </button>
            <div class="audience-detail border-t border-white/6 px-4 py-4 sm:px-5 sm:py-5 bg-slate-950/35">
              <div class="space-y-2 text-sm sm:text-[15px]">
                <div class="text-slate-300"><span class="text-slate-500">Location:</span> ${escapeHtml(user.location || "Not available")}</div>
                <div class="text-slate-300"><span class="text-slate-500">Provider:</span> ${escapeHtml(user.provider || "Unknown")}</div>
                <div class="text-slate-300"><span class="text-slate-500">Requested / Joined:</span> ${formatDate(user.createdAt)}</div>
                <div class="text-slate-300"><span class="text-slate-500">Last Logged In:</span> ${formatDate(user.lastLogin)}</div>
              </div>
            </div>
          </article>
        `,
          )
          .join("");
      }

      function renderLogs() {
        const el = document.getElementById("tab-logs");
        if (!el) return;
        const focusState = captureLogFilterFocus();
        if (!adminUsageLogs.length) {
          el.innerHTML = `<div class="rounded-[1.5rem] border border-dashed border-white/10 p-8 text-center text-slate-400">No usage logs saved yet.</div>`;
          return;
        }
        const activities = [...getFilteredLogs()].reverse().slice(-140);
        const queryStatus = analyzeSmartLogQuery(logFilters.query);
        const queryTone =
          queryStatus.status === "partial"
            ? "border-amber-400/20 bg-amber-500/10 text-amber-200"
            : "border-emerald-400/20 bg-emerald-500/10 text-emerald-200";
        el.innerHTML = `
          <div id="activity-terminal" class="terminal-shell terminal-shell-window rounded-[1.6rem] border border-cyan-500/12 shadow-[0_25px_80px_rgba(2,6,23,0.35)] overflow-hidden">
            <button onclick="toggleTerminalPane('activity-terminal')" class="w-full flex items-center justify-between gap-3 px-5 py-4 border-b border-white/8">
              <div>
                <div class="text-[11px] uppercase tracking-[0.22em] text-cyan-300 font-bold">Live Logs</div>
                <div class="text-sm text-slate-400 mt-2">Unified terminal stream</div>
              </div>
              <div class="flex items-center gap-3">
                <span class="px-3 py-1 rounded-full bg-cyan-500/15 text-cyan-300 text-[10px] font-bold uppercase tracking-[0.18em]">${activities.length} lines</span>
                <button onclick="event.stopPropagation(); openClearLogsModal()" class="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-rose-200 hover:bg-rose-500/15 transition-all">Clear Log</button>
                <svg class="terminal-chevron h-4 w-4 text-slate-500 transition-transform" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 011.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"></path></svg>
              </div>
            </button>
            <div class="border-b border-white/8 px-4 py-3">
              <div class="space-y-2">
                <input data-log-filter="query" value="${escapeHtml(logFilters.query)}" oninput="updateLogFilter(this.value)" placeholder="Try: username=charles and activity=login or email=gmail.com and tool=builder" class="w-full rounded-xl border border-cyan-500/20 bg-white/5 px-3 py-2.5 text-xs text-white outline-none focus:border-cyan-400" />
                <div class="text-[11px] text-slate-400 leading-relaxed">
                  Smart query:
                  <span class="text-slate-300">username=</span>,
                  <span class="text-slate-300">email=</span>,
                  <span class="text-slate-300">activity=</span>,
                  <span class="text-slate-300">tool=</span>,
                  <span class="text-slate-300">date=</span>
                  with
                  <span class="text-cyan-300 font-semibold">and</span>
                  /
                  <span class="text-cyan-300 font-semibold">or</span>.
                </div>
                <div class="rounded-xl border px-3 py-2 text-[11px] leading-relaxed ${queryTone}">
                  ${escapeHtml(queryStatus.message)}
                </div>
              </div>
            </div>
            <div class="terminal-body overflow-y-auto px-4 py-4" style="max-height:min(62vh, calc(100vh - 320px));">
              ${activities
                .map((item, index) => {
                  const actionText = String(item.action || "").toLowerCase();
                  const summaryText = String(item.summary || "").toLowerCase();
                  const isErrorLog = item.kind === "error";
                  const isExitLog =
                    actionText.includes("exit") || summaryText.includes("exit");
                  const isLoginLog =
                    actionText.includes("login") ||
                    summaryText.includes("login");
                  const isProLog =
                    actionText.includes("upgrade") ||
                    actionText.includes("pro") ||
                    summaryText.includes("upgrade") ||
                    summaryText.includes("pro");
                  const lineTone = isErrorLog || isExitLog
                    ? "text-rose-300"
                    : isProLog
                      ? "text-amber-300"
                      : isLoginLog
                        ? "text-emerald-300"
                        : !item.isAnonymous
                          ? "text-emerald-200"
                          : "text-slate-200";
                  const identityTone = isErrorLog || isExitLog
                    ? "text-rose-400/90"
                    : isProLog
                      ? "text-amber-300/90"
                      : isLoginLog
                        ? "text-emerald-400/90"
                        : "text-cyan-200/85";
                  return `
                <div class="terminal-line px-1 py-1.5">
                  <div class="text-right text-[11px] font-black text-slate-600 pt-0.5">${String(index + 1).padStart(4, "0")}</div>
                  <div class="text-sm leading-6 break-words ${lineTone}">
                    <span class="${identityTone}">[${escapeHtml(formatLogIdentity(item))}]</span>
                    <span class="${lineTone}">${escapeHtml(formatLogSummary(item))}</span>
                    <span class="text-slate-500">| ${escapeHtml(item.source || "web")}</span>
                    <span class="text-slate-600">-- ${escapeHtml(formatDate(item.createdAt))}</span>
                  </div>
                </div>
              `;
                })
                .join("")}
            </div>
          </div>
        `;
        requestAnimationFrame(() => {
          document.querySelectorAll(".terminal-body").forEach((node) => {
            node.scrollTop = node.scrollHeight;
          });
        });
        restoreLogFilterFocus(focusState);
      }

      function upsertLiveLog(log) {
        adminUsageLogs = [
          log,
          ...adminUsageLogs.filter((item) => item._id !== log._id),
        ].slice(0, 1000);
        bumpAdminUnread("logs");
        if (adminAnalytics) {
          adminAnalytics.totalUsageLogs = Math.max(
            adminAnalytics.totalUsageLogs || 0,
            adminUsageLogs.length,
          );
          if (log.kind === "error") {
            adminAnalytics.recentErrors =
              (adminAnalytics.recentErrors || 0) + 1;
          }
        }
        renderAnalyticsDetails();
        renderLogs();
      }

      function upsertDownload(download) {
        adminDownloads = [
          download,
          ...adminDownloads.filter((item) => item._id !== download._id),
        ].slice(0, 300);
        bumpAdminUnread("downloads");
        if (adminAnalytics) {
          adminAnalytics.totalDownloads = Math.max(
            adminAnalytics.totalDownloads || 0,
            adminDownloads.length,
          );
          if (adminAnalytics.last30Days) {
            adminAnalytics.last30Days.downloads =
              (adminAnalytics.last30Days.downloads || 0) + 1;
          }
        }
        renderAnalyticsDetails();
        renderDownloads();
      }

      function upsertWithdrawal(request) {
        adminWithdrawals = [
          request,
          ...adminWithdrawals.filter((item) => item._id !== request._id),
        ].slice(0, 300);
        bumpAdminUnread("withdrawals");
        renderWithdrawals();
      }

      function upsertPremiumRequest(request) {
        adminPremiumRequests = [
          request,
          ...adminPremiumRequests.filter((item) => item._id !== request._id),
        ].slice(0, 300);
        bumpAdminUnread("premium");
        loadAdminData();
      }

      function connectAdminLiveFeed() {
        if (adminSocket || localStorage.getItem(ADMIN_ACCESS_KEY) !== "granted")
          return;
        adminSocket = io();
        adminSocket.on("connect", () => setLiveStatus(true));
        adminSocket.on("disconnect", () => setLiveStatus(false));
        adminSocket.on("admin:usage-log", (payload) => {
          upsertLiveLog(payload);
        });
        adminSocket.on("admin:server-error", (payload) => {
          upsertLiveLog({ ...payload, kind: "error" });
        });
        adminSocket.on("admin:usage-log-cleared", () => {
          adminUsageLogs = [];
          renderLogs();
        });
        adminSocket.on("admin:premium-request-updated", (payload) => {
          upsertPremiumRequest(payload);
        });
        adminSocket.on("admin:download", (payload) => {
          upsertDownload(payload);
        });
        adminSocket.on("admin:withdrawal-updated", (payload) => {
          upsertWithdrawal(payload);
        });
      }

      async function updateFeedback(id, payload) {
        const res = await fetch(`/api/admin/feedbacks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getAdminHeaders() },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!data.success) {
          showAdminToast(data.message || "Could not update feedback.", "error");
          return;
        }
        await loadAdminData();
      }

      async function updatePremiumRequest(id, status) {
        const res = await fetch(`/api/admin/upgrade-requests/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getAdminHeaders() },
          body: JSON.stringify({ status }),
        });
        const data = await res.json();
        if (!data.success) {
          showAdminToast(data.message || "Could not update premium request.", "error");
          return;
        }
        await loadAdminData();
      }

      async function updateWithdrawalStatus(id, status) {
        const res = await fetch(`/api/admin/withdrawals/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getAdminHeaders() },
          body: JSON.stringify({ status }),
        });
        const data = await res.json();
        if (!data.success) {
          showAdminToast(data.message || "Could not update withdrawal.", "error");
          return;
        }
        await loadAdminData();
      }

      async function loadAdminData() {
        if (localStorage.getItem(ADMIN_ACCESS_KEY) !== "granted") return;
        try {
          const previousFeedbackIds = new Set(adminFeedbacks.map((item) => item._id));
          const previousUserIds = new Set(
            (adminAnalytics?.recentUsers || []).map((item) => item._id),
          );
          const headers = getAdminHeaders();
          const [feedbackRes, analyticsRes, usageLogRes, premiumRes, downloadsRes, withdrawalsRes] = await Promise.all([
            fetch("/api/admin/feedbacks", { headers }),
            fetch("/api/admin/analytics", { headers }),
            fetch("/api/admin/usage-logs", { headers }),
            fetch("/api/admin/upgrade-requests", { headers }),
            fetch("/api/admin/downloads", { headers }),
            fetch("/api/admin/withdrawals", { headers }),
          ]);
          const feedbackData = await feedbackRes.json();
          const analyticsData = await analyticsRes.json();
          const usageLogData = await usageLogRes.json();
          const premiumData = await premiumRes.json();
          const downloadsData = await downloadsRes.json();
          const withdrawalsData = await withdrawalsRes.json();
          adminFeedbacks = feedbackData.feedbacks || [];
          adminAnalytics = analyticsData.analytics || {};
          adminUsageLogs = usageLogData.logs || [];
          adminPremiumRequests = premiumData.requests || [];
          adminDownloads = downloadsData.downloads || [];
          adminWithdrawals = withdrawalsData.withdrawals || [];
          const nextFeedbacks = adminFeedbacks.filter((item) => !previousFeedbackIds.has(item._id));
          const nextUsers = (adminAnalytics?.recentUsers || []).filter(
            (item) => !previousUserIds.has(item._id),
          );
          if (hasLoadedAdminData && nextFeedbacks.length && activeAdminTab !== "feedbacks") {
            adminUnreadCounts.feedbacks += nextFeedbacks.length;
          }
          if (hasLoadedAdminData && nextUsers.length && activeAdminTab !== "users") {
            adminUnreadCounts.users += nextUsers.length;
          }
          hasLoadedAdminData = true;
          renderAdminTabBadges();
          renderAnalyticsDetails();
          renderFeedbacks();
          renderLogs();
          renderUsers();
          renderPremiumRequests();
          renderDownloads();
          renderWithdrawals();
          connectAdminLiveFeed();
          setLiveStatus(Boolean(adminSocket?.connected));
        } catch (error) {
          console.error(error);
          setLiveStatus(false);
          showAdminToast("Admin data could not be loaded.", "error");
        }
      }

      document
        .getElementById("admin-password")
        ?.addEventListener("keydown", (event) => {
          if (event.key === "Enter") unlockAdmin();
        });

      ensureAdminAccess();
      setLiveStatus(localStorage.getItem(ADMIN_ACCESS_KEY) === "granted");
    