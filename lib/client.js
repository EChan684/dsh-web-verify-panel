/**
 * dsh-web-verify-panel — client half (hand-written ModuleLoader bundle, no
 * build step; same shape as computer-user's client.js).
 *
 * Polls the host half's queue and opens each requested URL in the
 * dsh-better-sidebar embedded browser tab (right-hand sidebar), then acks the
 * host with the browser iframe's rectangle (as window fractions) so the agent
 * can screenshot ONLY the page region instead of the whole screen. To keep
 * desktop pages from losing content in a narrow panel, the panel is widened
 * temporarily (for WIDE_KEEP_MS) and restored afterwards; user dragging always
 * wins. If better-sidebar is absent the loop simply idles.
 */
window.__ModuleLoader__.load({
  id: "dsh-web-verify-panel",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var POLL_MS = 1500;
    var ACK_DELAY_MS = 450; // let the panel & iframe render before measuring
    var WIDE_FRACTION = 0.6; // temporary panel width target (fraction of viewport)
    var WIDE_MAX_PX = 1600;
    var WIDE_KEEP_MS = 60000; // keep the widened panel this long, then restore

    function postAck(id, rect) {
      var payload = { id: id };
      if (Array.isArray(rect)) payload.rect = rect;
      fetch("/web-verify-panel/ack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(function () {});
    }

    /** The built-in browser iframe: title equals its url, or the unique sandbox token. */
    function findFrame(url) {
      var frames = Array.from(document.querySelectorAll("iframe"));
      if (url) {
        var byTitle = frames.find(function (f) {
          return typeof f.title === "string" && f.title === url;
        });
        if (byTitle) return byTitle;
      }
      return frames.find(function (f) {
        var sb = String(f.getAttribute("sandbox") || "");
        return sb.indexOf("allow-downloads") !== -1;
      }) || null;
    }

    /** Window-fraction rect of the frame (what computer_screenshot.region expects). */
    function rectOf(frame) {
      var r = frame.getBoundingClientRect();
      var vw = window.innerWidth || 1;
      var vh = window.innerHeight || 1;
      return [
        Math.max(0, Math.min(1, r.left / vw)),
        Math.max(0, Math.min(1, r.top / vh)),
        Math.max(0, Math.min(1, r.right / vw)),
        Math.max(0, Math.min(1, r.bottom / vh)),
      ];
    }

    /** Walk up from the frame to the panel div (the one with a numeric style width). */
    function findPanel(frame) {
      for (var el = frame; el && el !== document.body; el = el.parentElement) {
        var w = parseFloat(el.style && el.style.width);
        if (isFinite(w) && w > 280 && Math.round(w) === w) return el;
      }
      return null;
    }

    var widenTimer = null;
    var widenObserver = null;

    /** Temporarily widen the panel so desktop pages fit; restore after WIDE_KEEP_MS. */
    function widenPanel(frame) {
      var panel = findPanel(frame);
      if (!panel || typeof MutationObserver !== "function") return;
      var original = parseFloat(panel.style.width);
      if (!isFinite(original) || original <= 0) return;
      var target = Math.min(window.innerWidth * WIDE_FRACTION, WIDE_MAX_PX);
      target = Math.max(280, Math.min(target, window.innerWidth));
      if (target <= original) return; // already wide enough: keep the user's width

      panel.setAttribute("data-wv-wide", "1");
      panel.style.width = target + "px";
      if (widenObserver) widenObserver.disconnect();
      widenObserver = new MutationObserver(function () {
        var cur = parseFloat(panel.style.width);
        if (!isFinite(cur)) return;
        if (cur === target) return; // our value: nothing to do
        if (cur !== original) {
          // user dragged (or state changed): give way, stop guarding
          widenObserver.disconnect();
          widenObserver = null;
          panel.removeAttribute("data-wv-wide");
          return;
        }
        panel.style.width = target + "px"; // React re-render reset it: re-apply
      });
      widenObserver.observe(panel, { attributes: true, attributeFilter: ["style"] });
      if (widenTimer) clearTimeout(widenTimer);
      widenTimer = setTimeout(function () {
        if (widenObserver) {
          widenObserver.disconnect();
          widenObserver = null;
        }
        if (panel.isConnected) {
          panel.removeAttribute("data-wv-wide");
          panel.style.width = original + "px";
        }
      }, WIDE_KEEP_MS);
    }

    function apply(ctx) {
      var api = null;
      try {
        ctx.inject(["betterSidebar"], function (sctx) {
          api = sctx.betterSidebar;
        });
      } catch (e) {
        // better-sidebar not loaded: stay inert
      }

      var inflight = false;
      function tick() {
        if (inflight) return;
        if (!api || typeof api.openTab !== "function") return;
        inflight = true;
        fetch("/web-verify-panel/poll")
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            if (!data || !data.items) return;
            data.items.forEach(function (item) {
              if (!item || typeof item.url !== "string") return;
              try {
                api.openTab({ type: "browser", url: item.url, title: item.title });
                setTimeout(function () {
                  var frame = findFrame(item.url);
                  var rect = frame ? rectOf(frame) : null;
                  if (frame) widenPanel(frame);
                  postAck(item.id, rect);
                }, ACK_DELAY_MS);
              } catch (e) {
                // leave unacked: the host-side tool reports the failure hint
              }
            });
          })
          .catch(function () {})
          .finally(function () { inflight = false; });
      }

      var start = function () {
        var timer = setInterval(tick, POLL_MS);
        tick();
        return function () { clearInterval(timer); };
      };
      if (ctx && typeof ctx.effect === "function") ctx.effect(start);
      else start();
    }

    exports.apply = apply;
    return module.exports;
  },
});
