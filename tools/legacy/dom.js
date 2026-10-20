// DOM methods the app uses that old Android WebViews lack (core-js covers the JavaScript built-ins, whatwg-fetch
// fetch, dialog-polyfill <dialog>). Plain ES5: this file is not run through Babel.
(function () {
  var proto = Element.prototype;
  function define(target, name, value) {
    if (!(name in target)) Object.defineProperty(target, name, { value: value, configurable: true, writable: true });
  }
  function toNode(value) {
    return value instanceof Node ? value : document.createTextNode(String(value));
  }
  function fragment(items) {
    var result = document.createDocumentFragment();
    for (var i = 0; i < items.length; i++) result.appendChild(toNode(items[i]));
    return result;
  }

  define(proto, 'matches', proto.webkitMatchesSelector || proto.msMatchesSelector);
  define(proto, 'closest', function (selector) {
    for (var node = this; node && node.nodeType === 1; node = node.parentElement || node.parentNode) {
      if (node.matches(selector)) return node;
    }
    return null;
  });
  define(proto, 'toggleAttribute', function (name, force) {
    var on = force === undefined ? !this.hasAttribute(name) : !!force;
    if (on) this.setAttribute(name, ''); else this.removeAttribute(name);
    return on;
  });
  define(proto, 'getAttributeNames', function () {
    var names = [];
    for (var i = 0; i < this.attributes.length; i++) names.push(this.attributes[i].name);
    return names;
  });

  [Element.prototype, CharacterData.prototype, DocumentType.prototype].forEach(function (target) {
    define(target, 'remove', function () { if (this.parentNode) this.parentNode.removeChild(this); });
    define(target, 'before', function () { if (this.parentNode) this.parentNode.insertBefore(fragment(arguments), this); });
    define(target, 'after', function () { if (this.parentNode) this.parentNode.insertBefore(fragment(arguments), this.nextSibling); });
    define(target, 'replaceWith', function () { if (this.parentNode) this.parentNode.replaceChild(fragment(arguments), this); });
  });
  [Element.prototype, Document.prototype, DocumentFragment.prototype].forEach(function (target) {
    define(target, 'append', function () { this.appendChild(fragment(arguments)); });
    define(target, 'prepend', function () { this.insertBefore(fragment(arguments), this.firstChild); });
    define(target, 'replaceChildren', function () {
      while (this.firstChild) this.removeChild(this.firstChild);
      this.appendChild(fragment(arguments));
    });
  });

  if (window.DOMTokenList) {
    define(DOMTokenList.prototype, 'replace', function (oldToken, newToken) {
      if (!this.contains(oldToken)) return false;
      this.remove(oldToken);
      this.add(newToken);
      return true;
    });
    // Old engines ignore all but the first name in add('a', 'b') and the second argument of toggle.
    var probe = document.createElement('i');
    probe.classList.add('a', 'b');
    if (!probe.classList.contains('b')) {
      var add = DOMTokenList.prototype.add;
      var remove = DOMTokenList.prototype.remove;
      DOMTokenList.prototype.add = function () { for (var i = 0; i < arguments.length; i++) add.call(this, arguments[i]); };
      DOMTokenList.prototype.remove = function () { for (var i = 0; i < arguments.length; i++) remove.call(this, arguments[i]); };
    }
    probe.classList.toggle('c', false);
    if (probe.classList.contains('c')) {
      var toggle = DOMTokenList.prototype.toggle;
      DOMTokenList.prototype.toggle = function (token, force) {
        if (force === undefined) return toggle.call(this, token);
        if (force) this.add(token); else this.remove(token);
        return !!force;
      };
    }
  }

  // KeyboardEvent.key (Chrome 51) from the older keyCode.
  if (window.KeyboardEvent && !('key' in KeyboardEvent.prototype)) {
    var KEYS = { 8: 'Backspace', 9: 'Tab', 13: 'Enter', 27: 'Escape', 32: ' ', 33: 'PageUp', 34: 'PageDown', 35: 'End', 36: 'Home', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown', 46: 'Delete' };
    Object.defineProperty(KeyboardEvent.prototype, 'key', {
      configurable: true,
      get: function () {
        var code = this.keyCode || this.which;
        if (KEYS[code]) return KEYS[code];
        if (this.type === 'keypress' && this.charCode) return String.fromCharCode(this.charCode);
        return code >= 48 && code <= 90 ? String.fromCharCode(code).toLowerCase() : 'Unidentified';
      },
    });
  }

  // window.scrollTo({ top, behavior }) and element.scrollIntoView({ block }) take objects only since Chrome 61.
  var scrollTo = window.scrollTo;
  window.scrollTo = function (x, y) {
    if (x && typeof x === 'object') return scrollTo.call(window, x.left || 0, x.top || 0);
    return scrollTo.call(window, x, y);
  };
  var scrollIntoView = proto.scrollIntoView;
  proto.scrollIntoView = function (options) {
    return scrollIntoView.call(this, options && typeof options === 'object' ? options.block !== 'end' && options.block !== 'nearest' : options);
  };

  // Each <dialog> gets dialog-polyfill's showModal()/close(), also those added later.
  if (window.dialogPolyfill && !window.HTMLDialogElement) {
    var register = function (root) {
      if (root.nodeType !== 1) return;
      var dialogs = root.tagName === 'DIALOG' ? [root] : root.querySelectorAll('dialog');
      for (var i = 0; i < dialogs.length; i++) if (!dialogs[i].showModal) window.dialogPolyfill.registerDialog(dialogs[i]);
    };
    document.addEventListener('DOMContentLoaded', function () {
      register(document.documentElement);
      var Observer = window.MutationObserver || window.WebKitMutationObserver;
      new Observer(function (changes) {
        changes.forEach(function (change) { for (var i = 0; i < change.addedNodes.length; i++) register(change.addedNodes[i]); });
      }).observe(document.documentElement, { childList: true, subtree: true });
    });
    // Code that creates a dialog and opens it at once.
    var createElement = document.createElement;
    document.createElement = function (name) {
      var element = createElement.apply(document, arguments);
      if (String(name).toLowerCase() === 'dialog') window.dialogPolyfill.registerDialog(element);
      return element;
    };
  }

  // Say what went wrong (core-js reports only "Unhandled promise rejection"); Android shows it in its log.
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason || event.detail && event.detail.reason;
    if (reason && console && console.error) console.error('Goodstock: ' + (reason.stack || reason.message || reason));
  });

  // Dark theme: old engines have no CSS custom properties, so the dark colours are a stylesheet of their own
  // (legacy/styles-dark.css, tools/build-legacy.mjs), swapped in when the app sets data-theme. The new sheet is added
  // before the old one goes, so the page is never unstyled.
  var root = document.documentElement;
  var pending = null;
  var showTheme = function () {
    var current = document.getElementById('legacy-styles');
    if (!current) return;
    var wanted = root.getAttribute('data-theme') === 'dark' ? 'legacy/styles-dark.css' : 'legacy/styles.css';
    if (pending) {
      // Switched again before the last sheet loaded.
      if (pending.parentNode) pending.parentNode.removeChild(pending);
      pending = null;
    }
    if (current.getAttribute('href') === wanted) return;
    var next = current.cloneNode();
    next.removeAttribute('id');
    next.setAttribute('href', wanted);
    pending = next;
    next.onload = function () {
      if (pending !== next) return;
      pending = null;
      if (current.parentNode) current.parentNode.removeChild(current);
      next.id = 'legacy-styles';
    };
    current.parentNode.insertBefore(next, current.nextSibling);
  };
  var ThemeObserver = window.MutationObserver || window.WebKitMutationObserver;
  new ThemeObserver(showTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  showTheme();

  // Layout fallbacks in legacy/styles.css apply under these classes.
  var supports = function (property, value) { return !!(window.CSS && CSS.supports && CSS.supports(property, value)); };
  var classes = [];
  if (!supports('display', 'grid')) classes.push('no-grid');
  if (!supports('--a', '0')) classes.push('no-css-vars');
  document.documentElement.className += ' legacy ' + classes.join(' ');
})();
