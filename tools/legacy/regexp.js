// Old browsers (Chrome before 50) have no regex flag u, so \p{L} and friends in patterns built at run time
// (new RegExp(...)) are rewritten here into plain character classes (Basic Multilingual Plane only, which covers
// every script the app knows). Regex literals are rewritten at build time by Babel; tools/build-legacy.mjs turns
// every `new RegExp(…)` and `RegExp(…)` into `legacyRegExp(…)` and fills in PROPERTIES.
(function () {
  var PROPERTIES = /* PROPERTIES */ {};
  var NativeRegExp = window.RegExp;

  function flagsOf(pattern) {
    return (pattern.global ? 'g' : '') + (pattern.ignoreCase ? 'i' : '') + (pattern.multiline ? 'm' : '');
  }

  function rewrite(source, dotAll) {
    var out = '';
    var inClass = false;
    for (var i = 0; i < source.length; i++) {
      var char = source[i];
      if (char === '\\') {
        var next = source[i + 1];
        var property = (next === 'p' || next === 'P') && /^\{([A-Za-z_]+)\}/.exec(source.slice(i + 2));
        if (property) {
          var ranges = PROPERTIES[property[1]];
          if (ranges === undefined) throw new SyntaxError('legacyRegExp: no data for \\p{' + property[1] + '}');
          if (next === 'P' && inClass) throw new SyntaxError('legacyRegExp: \\P{…} inside [] is not supported');
          out += inClass ? ranges : (next === 'P' ? '[^' : '[') + ranges + ']';
          i += 1 + property[0].length;
          continue;
        }
        var codePoint = next === 'u' && /^\{([0-9A-Fa-f]+)\}/.exec(source.slice(i + 2));
        if (codePoint) {
          out += '\\u' + ('0000' + codePoint[1]).slice(-4);
          i += 1 + codePoint[0].length;
          continue;
        }
        out += char + (next === undefined ? '' : next);
        i += 1;
        continue;
      }
      if (inClass) {
        if (char === ']') inClass = false;
        out += char;
        continue;
      }
      if (char === '[') {
        inClass = true;
        out += char;
        if (source[i + 1] === ']') { out += ']'; i += 1; }
        continue;
      }
      if (char === '(' && source[i + 1] === '?' && source[i + 2] === '<') {
        if (source[i + 3] === '=' || source[i + 3] === '!') throw new SyntaxError('legacyRegExp: lookbehind is not supported: ' + source);
        // Named group: keep it as a plain group.
        var end = source.indexOf('>', i);
        out += '(';
        i = end;
        continue;
      }
      out += dotAll && char === '.' ? '[\\s\\S]' : char;
    }
    return out;
  }

  window.legacyRegExp = function (pattern, flags) {
    var isRegExp = pattern instanceof NativeRegExp;
    var source = isRegExp ? pattern.source : pattern === undefined ? '' : String(pattern);
    var wanted = flags === undefined ? (isRegExp ? flagsOf(pattern) : '') : String(flags);
    if (/[us]/.test(wanted) || /\\[pP]\{|\(\?</.test(source)) source = rewrite(source, wanted.indexOf('s') >= 0);
    return new NativeRegExp(source, wanted.replace(/[usy]/g, ''));
  };
})();
