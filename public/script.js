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

    var closed = false;
    var autoOkTimer = null;

    function cleanup() {
      if (closed) return;
      closed = true;
      if (autoOkTimer !== null) {
        clearTimeout(autoOkTimer);
        autoOkTimer = null;
      }
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

    autoOkTimer = setTimeout(function () {
      autoOkTimer = null;
      onDismiss();
    }, EA_MODAL_AUTO_OK_MS);
  }

  /** この px より下にスクロールしたらバナー表示、上に戻したら非表示 */
  var EA_SCROLL_REVEAL_PX = 120;

  /** クーポン保存後モーダル: この秒後に OK と同じ処理で閉じる（手動 OK と同じ onClose を走らせる） */
  var EA_MODAL_AUTO_OK_MS = 3000;

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

  function initScreensLightbox() {
    var dialog = document.getElementById("screens-lb");
    var vp = document.querySelector("[data-screens-lb-viewport]");
    var strip = document.getElementById("screens-lb-strip");
    var prevBtn = document.querySelector("[data-screens-lb-prev]");
    var nextBtn = document.querySelector("[data-screens-lb-next]");
    var closeBtn = document.querySelector("[data-screens-lb-close]");
    var openBtns = document.querySelectorAll(".screens-grid__open");
    if (!dialog || !vp || !strip) return;

    var slides = strip.querySelectorAll(".screens-lb__slide");
    var n = slides.length;
    var lastOpener = null;

    function slideWidth() {
      return vp.clientWidth || 0;
    }

    function scrollToIndex(i) {
      if (n === 0) return;
      var idx = ((i % n) + n) % n;
      var w = slideWidth();
      if (w <= 0) return;
      vp.scrollLeft = idx * w;
    }

    function currentIndex() {
      var w = slideWidth();
      if (w <= 0) return 0;
      return Math.round(vp.scrollLeft / w);
    }

    function setExpanded(opener) {
      openBtns.forEach(function (b) {
        b.setAttribute("aria-expanded", b === opener ? "true" : "false");
      });
    }

    function openAtIndex(i, opener) {
      lastOpener = opener || null;
      dialog.showModal();
      setExpanded(lastOpener);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          scrollToIndex(i);
        });
      });
    }

    openBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var raw = btn.getAttribute("data-slide-index");
        var i = raw == null ? NaN : parseInt(raw, 10);
        if (isNaN(i)) return;
        openAtIndex(i, btn);
      });
    });

    if (prevBtn) {
      prevBtn.addEventListener("click", function () {
        scrollToIndex(currentIndex() - 1);
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener("click", function () {
        scrollToIndex(currentIndex() + 1);
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        dialog.close();
      });
    }

    dialog.addEventListener("close", function () {
      openBtns.forEach(function (b) {
        b.setAttribute("aria-expanded", "false");
      });
      if (lastOpener && typeof lastOpener.focus === "function") {
        lastOpener.focus();
      }
    });

    var resizeTimer = null;
    window.addEventListener("resize", function () {
      if (!dialog.open) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        scrollToIndex(currentIndex());
      }, 80);
    });

    dialog.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        scrollToIndex(currentIndex() - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        scrollToIndex(currentIndex() + 1);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initSmoothScroll();
    initEarlyAccessBannerScrollReveal();
    initEarlyAccessCoupon();
    initScreensLightbox();
  });
})();
