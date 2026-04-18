(function () {
  "use strict";

  function initSmoothScroll() {
    document.body.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var a = t.closest('a[href^="#"]');
      if (!a || !a.getAttribute("href") || a.getAttribute("href") === "#") return;
      var id = a.getAttribute("href").slice(1);
      if (!id) return;
      var el = document.getElementById(id);
      if (!el) return;
      e.preventDefault();
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      var path = window.location.pathname + window.location.search;
      history.pushState(null, "", path + "#" + id);
    });
  }

  function openEaCenterModal(message, onClose) {
    var modal = document.getElementById("ea-modal");
    var bodyEl = document.getElementById("ea-modal-body");
    var okBtn = document.getElementById("ea-modal-ok");
    var backdrop = modal && modal.querySelector(".ea-modal__backdrop");
    if (!modal || !bodyEl || !okBtn) {
      window.alert(message);
      if (onClose) onClose();
      return;
    }

    bodyEl.textContent = message;
    modal.removeAttribute("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    function cleanup() {
      modal.setAttribute("hidden", "");
      modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      okBtn.removeEventListener("click", onDismiss);
      if (backdrop) backdrop.removeEventListener("click", onDismiss);
      document.removeEventListener("keydown", onEsc);
      if (onClose) onClose();
    }

    function onDismiss() {
      cleanup();
    }

    function onEsc(e) {
      if (e.key === "Escape") cleanup();
    }

    okBtn.addEventListener("click", onDismiss);
    if (backdrop) backdrop.addEventListener("click", onDismiss);
    document.addEventListener("keydown", onEsc);
    okBtn.focus();
  }

  /** この px より下にスクロールしたらバナー表示、上に戻したら非表示 */
  var EA_SCROLL_REVEAL_PX = 120;

  function initEarlyAccessBannerScrollReveal() {
    var banner = document.getElementById("ea-floating-banner");
    if (!banner) return;

    var root = document.documentElement;
    var body = document.body;

    function scrollY() {
      return window.scrollY || window.pageYOffset || root.scrollTop || 0;
    }

    function sync() {
      var show = scrollY() > EA_SCROLL_REVEAL_PX;
      banner.classList.toggle("is-ea-revealed", show);
      banner.setAttribute("aria-hidden", show ? "false" : "true");
      root.classList.toggle("has-ea-banner-revealed", show);
      body.classList.toggle("has-ea-banner-revealed", show);
    }

    var ticking = false;
    function onScroll() {
      if (!ticking) {
        window.requestAnimationFrame(function () {
          sync();
          ticking = false;
        });
        ticking = true;
      }
    }

    sync();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    window.addEventListener("load", sync);
  }

  function initEarlyAccessCoupon() {
    var cfgEl = document.getElementById("ea-coupon-config");
    var btn = document.getElementById("early-access-coupon-btn");
    if (!cfgEl || !btn) return;
    var cfg;
    try {
      cfg = JSON.parse(cfgEl.textContent.trim());
    } catch (err) {
      return;
    }
    if (!cfg || !cfg.alert) return;

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      var code = cfg.code || "";
      var modalText = cfg.alert;
      if (cfg.hint) {
        modalText += "\n\n" + cfg.hint;
      }

      function afterModal() {
        var pricing = document.getElementById("pricing");
        if (pricing) {
          pricing.scrollIntoView({ behavior: "smooth", block: "start" });
          var path = window.location.pathname + window.location.search;
          history.pushState(null, "", path + "#pricing");
        }
      }

      function finish() {
        openEaCenterModal(modalText, afterModal);
      }

      if (code && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(finish).catch(finish);
      } else {
        finish();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initSmoothScroll();
    initEarlyAccessBannerScrollReveal();
    initEarlyAccessCoupon();
  });
})();
