/**
 * Client half of the in-session page search bundle.
 *
 * A browser-style find bar for the current page: Ctrl/Cmd+F opens a floating
 * bar registered in the frame-wide `shell.overlay` seat, typing counts every
 * match in the rendered text, Enter/Shift+Enter and the arrows walk the
 * matches, Esc closes. Matches are painted with the CSS Custom Highlight API
 * (`::highlight()`), so nothing in the React-rendered page is mutated: ranges
 * are recomputed from the live DOM and the page's own tree stays intact.
 *
 * The search scope is the whole document outside this bar — the same scope a
 * browser find uses — which covers the session transcript, tool output and
 * side panels. A MutationObserver refreshes the match set while the bar is
 * open (streaming replies, expanding tool cards, switching sessions), the
 * observer ignores mutations produced by the bar itself.
 *
 * The open command is registered through the host shortcuts service (so it
 * shows up in the shortcuts reference and is rebindable), when that service or
 * its registration is unavailable, a capture-phase keydown listener provides
 * the same Ctrl/Cmd+F behavior. All resources are owned by this plugin's
 * effects and are removed with it.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-page-search',
  factory: function (require) {
    'use strict'

    var React = require('react')
    var h = React.createElement

    var OVERLAY_ID = 'dsh-session-page-search-bar'
    var TRIGGER_ID = 'dsh-session-page-search-trigger'
    var COMMAND_ID = 'session.page.search'
    var MATCH_HIGHLIGHT = 'dsh-session-page-search-match'
    var ACTIVE_HIGHLIGHT = 'dsh-session-page-search-active'
    var CASE_KEY = 'dsh.session-page-search.match-case.v1'
    var WORD_KEY = 'dsh.session-page-search.whole-word.v1'
    var LOCALE_NS = 'sessionPageSearch'
    var MAX_MATCHES = 2000
    var MAX_QUERY_LENGTH = 300
    var REFRESH_DELAY_MS = 180

    var DICT = {
      en: {
        placeholder: 'Find in page',
        command: 'Find in page',
        previous: 'Previous match',
        next: 'Next match',
        close: 'Close find bar',
        caseSensitive: 'Match case',
        wholeWord: 'Match whole word',
        noResults: 'No results',
      },
      zh: {
        placeholder: '在当前页面中查找',
        command: '在当前页面中查找',
        previous: '上一个匹配',
        next: '下一个匹配',
        close: '关闭查找栏',
        caseSensitive: '区分大小写',
        wholeWord: '全词匹配',
        noResults: '无结果',
      },
    }

    // Elements whose text is not page content (or whose text nodes are not
    // paintable with ::highlight()).
    var SKIP_TAGS = {
      SCRIPT: 1,
      STYLE: 1,
      NOSCRIPT: 1,
      TEMPLATE: 1,
      TEXTAREA: 1,
      SELECT: 1,
      OPTION: 1,
      TITLE: 1,
      HEAD: 1,
      META: 1,
      LINK: 1,
      SVG: 1,
      IFRAME: 1,
      CANVAS: 1,
    }

    var CSS_TEXT = [
      '.dsh-sps-bar{position:fixed;left:50%;top:var(--dsh-frame-overlay-top,12px);transform:translateX(-50%);z-index:60;display:flex;align-items:center;gap:2px;box-sizing:border-box;max-width:min(560px,calc(100vw - 32px));padding:6px 8px 6px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-menu,rgba(251,251,251,.95));-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter,blur(18px));backdrop-filter:var(--dsw-menu-backdrop-filter,blur(18px));color:var(--dsw-alias-label-primary);box-shadow:0 14px 36px rgba(0,0,0,.16),0 2px 8px rgba(0,0,0,.08);font-family:inherit;font-size:13px;line-height:1.2;pointer-events:auto;animation:dsh-sps-in .16s cubic-bezier(.2,.8,.2,1);}',
      '@keyframes dsh-sps-in{from{opacity:0;transform:translate(-50%,-6px)}to{opacity:1;transform:translate(-50%,0)}}',
      '@media (prefers-reduced-motion:reduce){.dsh-sps-bar{animation:none}}',
      '.dsh-sps-bar:focus-within{border-color:var(--dsw-alias-border-l2);}',
      '.dsh-sps-icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;margin-right:6px;color:var(--dsw-alias-label-tertiary);}',
      '.dsh-sps-input{flex:1 1 auto;width:224px;min-width:120px;padding:4px 2px;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;caret-color:var(--dsw-alias-state-business-primary);}',
      '.dsh-sps-input::placeholder{color:var(--dsw-alias-label-tertiary);}',
      '.dsh-sps-count{flex:0 0 auto;min-width:46px;padding:0 8px 0 4px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);white-space:nowrap;}',
      '.dsh-sps-count[data-empty="true"]{color:var(--dsw-alias-state-error-primary);}',
      '.dsh-sps-divider{flex:0 0 auto;width:1px;height:18px;margin:0 6px;background:var(--dsw-alias-separator-primary);}',
      '.dsh-sps-btn{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:26px;height:26px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;transition:background-color .12s ease,color .12s ease;}',
      '.dsh-sps-btn:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-interactive-bg-hover-solid));color:var(--dsw-alias-label-primary);}',
      '.dsh-sps-btn:active{background:var(--dsw-alias-button-ghost-active-fill);}',
      '.dsh-sps-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px;}',
      '.dsh-sps-btn:disabled{background:transparent;color:var(--dsw-alias-label-dimmed);cursor:default;}',
      '.dsh-sps-aa{font-size:12px;font-weight:600;}',
      '.dsh-sps-aa[data-active="true"]{background:var(--dsw-alias-button-ghost-active-fill);color:var(--dsw-alias-label-primary);}',
      '.dsh-sps-word{text-decoration:underline;text-underline-offset:2px;}',
      '.dsh-sps-trigger{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:26px;height:26px;padding:0;border:0;border-radius:var(--dsw-radius-sm,5px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;transition:background-color .12s ease,color .12s ease;}',
      '.dsh-sps-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-interactive-bg-hover-solid));color:var(--dsw-alias-label-primary);}',
      '.dsh-sps-trigger:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px;}',
      '@media (max-width:640px){.dsh-sps-bar{max-width:calc(100vw - 20px);padding-right:6px;}.dsh-sps-input{width:150px;min-width:80px;}.dsh-sps-count{min-width:38px;padding:0 4px;}.dsh-sps-divider{margin:0 4px;}}',
      '::highlight(dsh-session-page-search-match){background-color:var(--dsw-alias-bg-document-selection);color:inherit;}',
      '::highlight(dsh-session-page-search-active){background-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-foreground);}',
    ].join('\n')

    /**
     * Install the plugin stylesheet once. Highlight rules must exist even while
     * the bar is dismissed (a stale range must never paint un-styled), and the
     * composer trigger is rendered outside the bar, so the stylesheet cannot
     * live inside the bar component.
     */
    function installStyles() {
      var tag = document.createElement('style')
      tag.setAttribute('data-dsh-session-page-search', '')
      tag.textContent = CSS_TEXT
      document.head.appendChild(tag)
      try {
        return function () {
          if (tag.parentNode) tag.parentNode.removeChild(tag)
        }
      } catch (error) {
        return function () {}
      }
    }

    function readCaseSensitive() {
      try {
        return window.localStorage.getItem(CASE_KEY) === '1'
      } catch (error) {
        return false
      }
    }

    function writeCaseSensitive(value) {
      try {
        window.localStorage.setItem(CASE_KEY, value ? '1' : '0')
      } catch (error) {
        // Storage may be unavailable, the toggle then only lasts this session.
      }
    }

    function readWholeWord() {
      try {
        return window.localStorage.getItem(WORD_KEY) === '1'
      } catch (error) {
        return false
      }
    }

    function writeWholeWord(value) {
      try {
        window.localStorage.setItem(WORD_KEY, value ? '1' : '0')
      } catch (error) {
        // Storage may be unavailable, the toggle then only lasts this session.
      }
    }

    // Word characters follow the familiar ASCII identifier class, the same one
    // search widgets use for "whole word": `foo` will not match `foobar` or
    // `my_foo`, while CJK text keeps behaving like a plain substring search
    // (CJK glyphs are separators here, not word characters).
    function isWordCharacter(character) {
      if (character === '') return false
      var code = character.charCodeAt(0)
      return (
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        code === 95
      )
    }

    function normalizeLang(value) {
      var lang = String(value || '').toLowerCase()
      return lang.indexOf('zh') === 0 ? 'zh' : 'en'
    }

    function documentLang() {
      try {
        return (document.documentElement && document.documentElement.lang) || (navigator && navigator.language) || 'en'
      } catch (error) {
        return 'en'
      }
    }

    /**
     * Host locale first (so the plugin follows Settings > Language), internal
     * dictionary as a fallback when the locale service is unavailable or its
     * registration shape rejects an external namespace.
     */
    function createTranslator(ctx) {
      var service = null
      try {
        service = ctx.locale || (typeof ctx.get === 'function' ? ctx.get('locale') : undefined)
      } catch (error) {
        service = null
      }

      var disposers = []
      var bound = null
      if (service && typeof service.register === 'function' && typeof service.bind === 'function') {
        try {
          var disposeEn = service.register(LOCALE_NS, 'en', DICT.en)
          var disposeZh = service.register(LOCALE_NS, 'zh', DICT.zh)
          if (typeof disposeEn === 'function') disposers.push(disposeEn)
          if (typeof disposeZh === 'function') disposers.push(disposeZh)
          bound = service.bind(LOCALE_NS)
        } catch (primaryError) {
          try {
            var disposeBoth = service.register(LOCALE_NS, DICT)
            if (typeof disposeBoth === 'function') disposers.push(disposeBoth)
            bound = service.bind(LOCALE_NS)
          } catch (fallbackError) {
            bound = null
          }
        }
      }

      function activeLang() {
        try {
          if (service && typeof service.getSnapshot === 'function') {
            var snapshot = service.getSnapshot()
            var active = snapshot && (snapshot.active || snapshot.locale || snapshot.id || snapshot.language)
            if (typeof active === 'string' && active !== '') return normalizeLang(active)
          }
        } catch (error) {
          // fall through to the document language
        }
        return normalizeLang(documentLang())
      }

      function t(key) {
        if (bound) {
          try {
            var value = bound(key)
            if (typeof value === 'string' && value !== '' && value !== key) return value
          } catch (error) {
            // fall through to the internal dictionary
          }
        }
        var dict = DICT[activeLang()] || DICT.en
        return typeof dict[key] === 'string' ? dict[key] : key
      }

      function subscribe(listener) {
        if (service && typeof service.subscribe === 'function') {
          try {
            return service.subscribe(listener)
          } catch (error) {
            return null
          }
        }
        return null
      }

      return {
        t: t,
        subscribe: subscribe,
        dispose: function () {
          for (var i = 0; i < disposers.length; i++) {
            try {
              disposers[i]()
            } catch (error) {
              // The locale service may already have dropped this namespace.
            }
          }
          disposers = []
        },
      }
    }

    function supportsHighlights() {
      try {
        return typeof Highlight === 'function' && typeof CSS !== 'undefined' && CSS !== null && CSS.highlights !== undefined && typeof CSS.highlights.set === 'function'
      } catch (error) {
        return false
      }
    }

    function isInsideOwnOverlay(element) {
      var node = element
      while (node && node !== document.body) {
        if (node.nodeType === 1 && typeof node.hasAttribute === 'function' && node.hasAttribute('data-dsh-page-search-ignore')) return true
        node = node.parentElement
      }
      return false
    }

    /**
     * Search model. Owns the query, the match ranges, the highlight registry
     * and the live-DOM refresh, and publishes changes to the React view. This
     * object is plain state plus DOM work, the React half only renders it.
     */
    function createController() {
      var listeners = []
      var state = {
        open: false,
        query: '',
        caseSensitive: readCaseSensitive(),
        wholeWord: readWholeWord(),
        matches: [],
        active: 0,
        truncated: false,
        highlight: supportsHighlights(),
        focusSignal: 0,
      }
      var refreshTimer = 0
      var observer = null
      // Scroll positions of the containers that match navigation scrolled
      // during this open session. Captured just before the first scroll and put
      // back when the bar closes, so dismissing the find bar does not leave the
      // page parked on a match.
      var scrollMemory = []

      function rememberScroll(element) {
        if (!element || element.nodeType !== 1) return
        for (var i = 0; i < scrollMemory.length; i++) {
          if (scrollMemory[i].element === element) return
        }
        scrollMemory.push({ element: element, top: element.scrollTop, left: element.scrollLeft })
      }

      function restoreScroll() {
        for (var i = 0; i < scrollMemory.length; i++) {
          var record = scrollMemory[i]
          try {
            if (record.element.isConnected) {
              record.element.scrollTop = record.top
              record.element.scrollLeft = record.left
            }
          } catch (error) {
            // A replaced or detached container has nothing to restore.
          }
        }
        scrollMemory = []
      }

      function forgetScroll() {
        scrollMemory = []
      }

      /**
       * Snapshot the scroll positions of every scroller that a Session search
       * can plausibly move: the window, the transcript scrollport, its scroll
       * ancestors and its scrollable descendants (code blocks, panes). Taking
       * this once when the bar opens lets close() put the page back exactly
       * where it was, no matter which container match navigation scrolled.
       */
      function snapshotScroll() {
        scrollMemory = []
        var candidates = []
        var scrolling = document.scrollingElement
        if (scrolling) candidates.push(scrolling)
        var pane = null
        try {
          pane = document.querySelector('[data-conversation-scroll]')
        } catch (error) {
          pane = null
        }
        if (pane) {
          candidates.push(pane)
          var parent = pane.parentElement
          while (parent && parent !== document.body) {
            candidates.push(parent)
            parent = parent.parentElement
          }
          var descendants = pane.querySelectorAll('*')
          for (var i = 0; i < descendants.length; i++) candidates.push(descendants[i])
        }
        for (var c = 0; c < candidates.length; c++) {
          var element = candidates[c]
          if (!element || element.nodeType !== 1) continue
          if (element.scrollHeight > element.clientHeight + 4 || element.scrollWidth > element.clientWidth + 4) {
            rememberScroll(element)
          }
        }
      }

      function emit() {
        for (var i = 0; i < listeners.length; i++) {
          try {
            listeners[i]()
          } catch (error) {
            // A broken listener must not break the find bar.
          }
        }
      }

      function subscribe(listener) {
        listeners.push(listener)
        return function () {
          var index = listeners.indexOf(listener)
          if (index !== -1) listeners.splice(index, 1)
        }
      }

      function clearPainted() {
        if (!state.highlight) return
        try {
          CSS.highlights.delete(MATCH_HIGHLIGHT)
          CSS.highlights.delete(ACTIVE_HIGHLIGHT)
        } catch (error) {
          // Highlight registry unavailable, nothing to clear.
        }
      }

      function paint() {
        if (!state.highlight) return
        try {
          var all = new Highlight()
          for (var i = 0; i < state.matches.length; i++) all.add(state.matches[i].range)
          CSS.highlights.set(MATCH_HIGHLIGHT, all)
          var current = state.matches[state.active]
          if (current) {
            var active = new Highlight()
            active.add(current.range)
            CSS.highlights.set(ACTIVE_HIGHLIGHT, active)
          } else {
            CSS.highlights.delete(ACTIVE_HIGHLIGHT)
          }
        } catch (error) {
          // A detached range can make Highlight registration throw, the next
          // mutation-driven refresh rebuilds the ranges.
        }
      }

      function elementVisible(element, cache) {
        if (cache.has(element)) return cache.get(element)
        var visible = true
        try {
          if (typeof element.checkVisibility === 'function') {
            visible = element.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })
          } else {
            var style = window.getComputedStyle(element)
            visible = style.display !== 'none' && style.visibility !== 'hidden'
          }
        } catch (error) {
          visible = true
        }
        cache.set(element, visible)
        return visible
      }

      function collect(query, caseSensitive, wholeWord) {
        var matches = []
        var truncated = false
        if (!query) return { matches: matches, truncated: truncated }
        var needle = caseSensitive ? query : query.toLowerCase()
        var ignoredCache = new Map()
        var visibilityCache = new Map()

        function ignored(element) {
          if (ignoredCache.has(element)) return ignoredCache.get(element)
          var result = isInsideOwnOverlay(element)
          ignoredCache.set(element, result)
          return result
        }

        var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode: function (node) {
            var value = node.nodeValue
            if (value === null || value === undefined || value.length === 0) return NodeFilter.FILTER_REJECT
            if (!/\S/.test(value)) return NodeFilter.FILTER_REJECT
            var parent = node.parentElement
            if (!parent) return NodeFilter.FILTER_REJECT
            if (SKIP_TAGS[parent.tagName]) return NodeFilter.FILTER_REJECT
            return NodeFilter.FILTER_ACCEPT
          },
        })

        var node = walker.nextNode()
        while (node) {
          var text = node.nodeValue
          var haystack = caseSensitive ? text : text.toLowerCase()
          var index = haystack.indexOf(needle)
          if (index !== -1) {
            var parent = node.parentElement
            if (parent && !ignored(parent) && elementVisible(parent, visibilityCache)) {
              while (index !== -1) {
                if (wholeWord) {
                  var before = index > 0 ? text.charAt(index - 1) : ''
                  var after = index + needle.length < text.length ? text.charAt(index + needle.length) : ''
                  if (isWordCharacter(before) || isWordCharacter(after)) {
                    index = haystack.indexOf(needle, index + 1)
                    continue
                  }
                }
                if (matches.length >= MAX_MATCHES) {
                  truncated = true
                  break
                }
                var range = document.createRange()
                range.setStart(node, index)
                range.setEnd(node, index + needle.length)
                matches.push({ range: range, node: node, start: index })
                index = haystack.indexOf(needle, index + needle.length)
              }
              if (truncated) break
            }
          }
          node = walker.nextNode()
        }

        return { matches: matches, truncated: truncated }
      }

      /**
       * Scroll the active match into the middle of whichever ancestor actually
       * scrolls (the transcript scroller, a code block, the rightbar…). The
       * fallback is scrollIntoView on the match's parent element.
       */
      function reveal() {
        var current = state.matches[state.active]
        if (!current) return
        var rect = null
        try {
          rect = current.range.getBoundingClientRect()
        } catch (error) {
          return
        }
        if (!rect || (rect.width === 0 && rect.height === 0)) return
        var element = current.node.parentElement
        if (!element) return

        var node = element
        while (node && node !== document.body && node !== document.documentElement) {
          var style = null
          try {
            style = window.getComputedStyle(node)
          } catch (error) {
            style = null
          }
          if (style && (style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 2) {
            var container = node.getBoundingClientRect()
            var delta = (rect.top - container.top) - container.height / 2 + rect.height / 2
            rememberScroll(node)
            try {
              if (typeof node.scrollTo === 'function') node.scrollTo({ top: node.scrollTop + delta, behavior: 'smooth' })
              else node.scrollTop = node.scrollTop + delta
            } catch (error) {
              node.scrollTop = node.scrollTop + delta
            }
            return
          }
          node = node.parentElement
        }

        // The fallback may scroll several ancestors (and the window), remember
        // every scroller before letting scrollIntoView move them.
        var ancestor = element
        while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
          var ancestorStyle = null
          try {
            ancestorStyle = window.getComputedStyle(ancestor)
          } catch (error) {
            ancestorStyle = null
          }
          if (ancestorStyle && (ancestorStyle.overflowY === 'auto' || ancestorStyle.overflowY === 'scroll') && ancestor.scrollHeight > ancestor.clientHeight + 2) {
            rememberScroll(ancestor)
          }
          ancestor = ancestor.parentElement
        }
        rememberScroll(document.scrollingElement)
        try {
          if (typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'center', inline: 'nearest' })
        } catch (error) {
          // Element not laid out, leave the viewport alone.
        }
      }

      function run(options) {
        var preserve = options && options.preserve === true
        var revealAfter = options && options.reveal === true
        var previous = preserve ? state.matches[state.active] : null
        var outcome = collect(state.query, state.caseSensitive, state.wholeWord)
        state.matches = outcome.matches
        state.truncated = outcome.truncated
        state.active = 0
        if (previous && outcome.matches.length > 0) {
          for (var i = 0; i < outcome.matches.length; i++) {
            if (outcome.matches[i].node === previous.node) {
              state.active = i
              break
            }
          }
        }
        paint()
        if (revealAfter && state.open && state.matches.length > 0) reveal()
        emit()
      }

      function refreshFromMutations() {
        if (!state.open || state.query === '') return
        run({ preserve: true, reveal: false })
      }

      function scheduleRefresh() {
        if (refreshTimer !== 0) return
        refreshTimer = window.setTimeout(function () {
          refreshTimer = 0
          refreshFromMutations()
        }, REFRESH_DELAY_MS)
      }

      function startObserver() {
        if (observer || typeof MutationObserver !== 'function' || !document.body) return
        observer = new MutationObserver(function (records) {
          if (!state.open || state.query === '') return
          var relevant = false
          for (var i = 0; i < records.length; i++) {
            var target = records[i].target
            var element = target && target.nodeType === 1 ? target : target && target.parentElement
            if (element && isInsideOwnOverlay(element)) continue
            relevant = true
            break
          }
          if (relevant) scheduleRefresh()
        })
        observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      }

      function open() {
        var wasOpen = state.open
        state.open = true
        state.focusSignal += 1
        // A fresh open starts a fresh scroll snapshot, re-opening an already
        // open bar must keep the original snapshot it may still need to restore.
        if (!wasOpen) snapshotScroll()
        if (state.query !== '') run({ preserve: true, reveal: true })
        else {
          state.matches = []
          state.active = 0
          state.truncated = false
          clearPainted()
        }
        emit()
      }

      function close() {
        state.open = false
        state.matches = []
        state.active = 0
        state.truncated = false
        clearPainted()
        restoreScroll()
        emit()
      }

      function setQuery(query) {
        var next = String(query === null || query === undefined ? '' : query)
        if (next.length > MAX_QUERY_LENGTH) next = next.slice(0, MAX_QUERY_LENGTH)
        state.query = next
        run({ preserve: false, reveal: true })
      }

      function toggleCaseSensitive() {
        state.caseSensitive = !state.caseSensitive
        writeCaseSensitive(state.caseSensitive)
        if (state.query !== '') run({ preserve: true, reveal: true })
        else emit()
      }

      function toggleWholeWord() {
        state.wholeWord = !state.wholeWord
        writeWholeWord(state.wholeWord)
        if (state.query !== '') run({ preserve: true, reveal: true })
        else emit()
      }

      function step(delta) {
        var total = state.matches.length
        if (total === 0) return
        state.active = (state.active + delta + total) % total
        paint()
        reveal()
        emit()
      }

      function dispose() {
        if (refreshTimer !== 0) {
          window.clearTimeout(refreshTimer)
          refreshTimer = 0
        }
        if (observer) {
          observer.disconnect()
          observer = null
        }
        forgetScroll()
        listeners = []
        clearPainted()
      }

      startObserver()

      return {
        getState: function () {
          return state
        },
        subscribe: subscribe,
        open: open,
        close: close,
        setQuery: setQuery,
        toggleCaseSensitive: toggleCaseSensitive,
        toggleWholeWord: toggleWholeWord,
        step: step,
        dispose: dispose,
      }
    }

    function icon(children, size) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        children,
      )
    }

    function searchGlyph() {
      return icon(
        [
          h('circle', { key: 'lens', cx: 7, cy: 7, r: 4.2, stroke: 'currentColor', strokeWidth: 1.6 }),
          h('path', { key: 'handle', d: 'M10.2 10.2 13.2 13.2', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        ],
        14,
      )
    }

    function chevronGlyph(up) {
      return icon(
        [h('path', { key: 'chevron', d: up ? 'M4 10 8 6l4 4' : 'M4 6l4 4 4-4', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' })],
        14,
      )
    }

    function closeGlyph() {
      return icon(
        [h('path', { key: 'cross', d: 'M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' })],
        14,
      )
    }

    function createFindBar(ctx, controller, translator) {
      var t = translator.t

      return function FindBar() {
        var tick = React.useState(0)
        var force = tick[1]
        var localeTick = React.useState(0)
        var forceLocale = localeTick[1]
        var inputRef = React.useRef(null)

        React.useEffect(function () {
          return controller.subscribe(function () {
            force(function (value) { return value + 1 })
          })
        }, [])

        React.useEffect(function () {
          var off = translator.subscribe(function () {
            forceLocale(function (value) { return value + 1 })
          })
          return function () {
            if (typeof off === 'function') off()
          }
        }, [])

        var state = controller.getState()

        React.useEffect(function () {
          if (!state.open) return
          var input = inputRef.current
          if (!input) return
          try {
            input.focus()
            if (typeof input.select === 'function') input.select()
          } catch (error) {
            // Focus can be refused while a native dialog owns the window.
          }
        }, [state.open, state.focusSignal])

        React.useEffect(function () {
          if (!state.open) return undefined
          var onEscape = function (event) {
            if (event.key !== 'Escape' || event.defaultPrevented) return
            event.preventDefault()
            event.stopPropagation()
            controller.close()
          }
          document.addEventListener('keydown', onEscape, true)
          return function () {
            document.removeEventListener('keydown', onEscape, true)
          }
        }, [state.open])

        // Anchor the bar over the Session transcript column instead of the
        // window corner: it centers over the conversation pane, stays inside the
        // viewport (and inside the pane when the pane is wide enough), and falls
        // back to the viewport center when no transcript is mounted.
        var placementPair = React.useState(null)
        var placement = placementPair[0]
        var setPlacement = placementPair[1]
        var barRef = React.useRef(null)
        var useAnchorEffect = React.useLayoutEffect || React.useEffect

        useAnchorEffect(function () {
          if (!state.open) return undefined
          var frame = 0
          var poll = 0
          var paneObserver = null
          var observedPane = null

          function measure() {
            var pane = null
            try {
              pane = document.querySelector('[data-conversation-scroll]')
            } catch (error) {
              pane = null
            }
            var rect = pane && typeof pane.getBoundingClientRect === 'function' ? pane.getBoundingClientRect() : null
            var width = 0
            try {
              width = barRef.current ? barRef.current.offsetWidth : 0
            } catch (error) {
              width = 0
            }
            if (!width || width <= 0) width = 432
            var half = width / 2
            var viewportWidth = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 960
            var left
            if (rect && rect.width > 120) {
              left = rect.left + rect.width / 2
              var paneMin = rect.left + half
              var paneMax = rect.right - half
              if (paneMax > paneMin) left = Math.min(paneMax, Math.max(paneMin, left))
            } else {
              left = viewportWidth / 2
            }
            left = Math.min(viewportWidth - half - 12, Math.max(half + 12, left))
            var top = 12
            if (rect && rect.top > 0) top = rect.top + 10
            setPlacement(function (previous) {
              if (previous !== null && Math.abs(previous.left - left) < 0.5 && Math.abs(previous.top - top) < 0.5) return previous
              return { left: left, top: top }
            })
            if (pane !== observedPane) {
              if (paneObserver) paneObserver.disconnect()
              paneObserver = null
              observedPane = pane
              if (pane && typeof ResizeObserver === 'function') {
                try {
                  paneObserver = new ResizeObserver(schedule)
                  paneObserver.observe(pane)
                } catch (error) {
                  paneObserver = null
                }
              }
            }
          }

          function schedule() {
            if (frame !== 0) return
            frame = window.requestAnimationFrame(function () {
              frame = 0
              measure()
            })
          }

          // Measure synchronously after commit so the first painted frame
          // already has the anchor (the bar width is available on the ref).
          measure()
          window.addEventListener('resize', schedule)
          // Session switches replace the scrollport element, this cheap poll
          // re-anchors after such a replacement without a body-wide observer.
          poll = window.setInterval(schedule, 400)
          return function () {
            window.removeEventListener('resize', schedule)
            window.clearInterval(poll)
            if (frame !== 0) window.cancelAnimationFrame(frame)
            if (paneObserver) paneObserver.disconnect()
            setPlacement(null)
          }
        }, [state.open])

        if (!state.open) return null

        function onKeyDown(event) {
          // The bar owns these keys while it is open, do not let them reach the
          // page, the composer or a global shortcut dispatch behind the bar.
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            controller.close()
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            controller.step(event.shiftKey ? -1 : 1)
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            controller.step(1)
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            controller.step(-1)
          }
        }

        // Keep focus on the input while clicking the bar's own controls.
        function keepFocus(event) {
          event.preventDefault()
        }

        var total = state.matches.length
        var countText = ''
        if (state.query !== '') {
          countText = total === 0 ? t('noResults') : (state.active + 1) + '/' + total + (state.truncated ? '+' : '')
        }

        return h(
          'div',
          {
            ref: barRef,
            className: 'dsh-sps-bar',
            role: 'search',
            'aria-label': t('command'),
            'data-dsh-page-search-ignore': '',
            onKeyDown: onKeyDown,
            style: placement === null ? undefined : { left: placement.left + 'px', top: placement.top + 'px' },
          },
          h('span', { key: 'glyph', className: 'dsh-sps-icon' }, searchGlyph()),
          h('input', {
            key: 'input',
            ref: inputRef,
            className: 'dsh-sps-input',
            type: 'text',
            value: state.query,
            placeholder: t('placeholder'),
            'aria-label': t('placeholder'),
            autoComplete: 'off',
            spellCheck: false,
            onChange: function (event) {
              controller.setQuery(event.target.value)
            },
          }),
          countText !== ''
            ? h(
                'span',
                {
                  key: 'count',
                  className: 'dsh-sps-count',
                  'data-empty': total === 0 ? 'true' : 'false',
                  'aria-live': 'polite',
                },
                countText,
              )
            : null,
          h('span', { key: 'divider', className: 'dsh-sps-divider' }),
          h(
            'button',
            {
              key: 'case',
              type: 'button',
              className: 'dsh-sps-btn dsh-sps-aa',
              title: t('caseSensitive'),
              'aria-label': t('caseSensitive'),
              'aria-pressed': state.caseSensitive ? 'true' : 'false',
              'data-active': state.caseSensitive ? 'true' : 'false',
              onMouseDown: keepFocus,
              onClick: function () {
                controller.toggleCaseSensitive()
              },
            },
            'Aa',
          ),
          h(
            'button',
            {
              key: 'word',
              type: 'button',
              className: 'dsh-sps-btn dsh-sps-aa dsh-sps-word',
              title: t('wholeWord'),
              'aria-label': t('wholeWord'),
              'aria-pressed': state.wholeWord ? 'true' : 'false',
              'data-active': state.wholeWord ? 'true' : 'false',
              onMouseDown: keepFocus,
              onClick: function () {
                controller.toggleWholeWord()
              },
            },
            'ab',
          ),
          h(
            'button',
            {
              key: 'prev',
              type: 'button',
              className: 'dsh-sps-btn',
              title: t('previous'),
              'aria-label': t('previous'),
              disabled: total === 0,
              onMouseDown: keepFocus,
              onClick: function () {
                controller.step(-1)
              },
            },
            chevronGlyph(true),
          ),
          h(
            'button',
            {
              key: 'next',
              type: 'button',
              className: 'dsh-sps-btn',
              title: t('next'),
              'aria-label': t('next'),
              disabled: total === 0,
              onMouseDown: keepFocus,
              onClick: function () {
                controller.step(1)
              },
            },
            chevronGlyph(false),
          ),
          h(
            'button',
            {
              key: 'close',
              type: 'button',
              className: 'dsh-sps-btn',
              title: t('close'),
              'aria-label': t('close'),
              onMouseDown: keepFocus,
              onClick: function () {
                controller.close()
              },
            },
            closeGlyph(),
          ),
        )
      }
    }

    /**
     * The composer-toolbar affordance: a small magnifier that opens the bar,
     * so the feature is discoverable without knowing the shortcut.
     */
    function createSearchTrigger(ctx, controller, translator) {
      return function SearchTrigger() {
        var localeTick = React.useState(0)
        var forceLocale = localeTick[1]
        React.useEffect(function () {
          var off = translator.subscribe(function () {
            forceLocale(function (value) { return value + 1 })
          })
          return function () {
            if (typeof off === 'function') off()
          }
        }, [])

        var label = translator.t('command')
        return h(
          'button',
          {
            type: 'button',
            className: 'dsh-sps-trigger',
            title: label,
            'aria-label': label,
            onClick: function () {
              controller.open()
            },
          },
          searchGlyph(16),
        )
      }
    }

    function registerOpenCommand(shortcuts, translator, controller) {
      if (!shortcuts || typeof shortcuts.register !== 'function') return null
      try {
        var dispose = shortcuts.register({
          id: COMMAND_ID,
          label: function () {
            return translator.t('command')
          },
          aliases: ['find', 'search', 'page', 'session'],
          defaults: {
            // Desktop app: the familiar browser gesture. A browser tab keeps
            // its native find-in-page on Ctrl/Cmd+F, so the Web shell gets
            // Ctrl/Cmd+Alt+F instead (desktop-profile defaults are what the
            // receiving device uses).
            'desktop:macos': { code: 'KeyF', modifiers: ['primary'] },
            'desktop:windows': { code: 'KeyF', modifiers: ['primary'] },
            'desktop:linux': { code: 'KeyF', modifiers: ['primary'] },
            'web:macos': { code: 'KeyF', modifiers: ['primary', 'alt'] },
            'web:windows': { code: 'KeyF', modifiers: ['primary', 'alt'] },
          },
          regions: ['page', 'editable', 'terminal'],
          modals: [],
          resolve: function () {
            return {
              status: 'handled',
              run: function () {
                controller.open()
              },
            }
          },
        })
        return typeof dispose === 'function' ? dispose : function () {}
      } catch (error) {
        try {
          console.error('[dsh-session-page-search] shortcut registration failed', error)
        } catch (ignored) {
          // Never let diagnostics break activation.
        }
        return null
      }
    }

    function apply(ctx) {
      if (typeof document === 'undefined' || !document.body) return

      var translator = createTranslator(ctx)
      var controller = createController()

      if (typeof ctx.effect === 'function') {
        ctx.effect(installStyles, 'dsh-session-page-search: stylesheet')
        ctx.effect(function () {
          return function () {
            controller.dispose()
          }
        }, 'dsh-session-page-search: find controller')
        ctx.effect(function () {
          return function () {
            translator.dispose()
          }
        }, 'dsh-session-page-search: locale dictionaries')
      } else {
        installStyles()
      }

      var FindBar = createFindBar(ctx, controller, translator)
      var SearchTrigger = createSearchTrigger(ctx, controller, translator)

      if (ctx.slots && typeof ctx.slots.inject === 'function' && typeof ctx.slots.register === 'function') {
        ctx.slots.inject('shell.overlay', function () {
          var dispose = ctx.slots.register(
            {
              name: 'shell.overlay',
              id: OVERLAY_ID,
              order: 20,
              label: function () {
                return translator.t('command')
              },
            },
            FindBar,
          )
          return typeof dispose === 'function' ? dispose : function () {}
        })
        ctx.slots.inject('conversation.input.left', function () {
          var dispose = ctx.slots.register(
            {
              name: 'conversation.input.left',
              id: TRIGGER_ID,
              order: 40,
              label: function () {
                return translator.t('command')
              },
            },
            SearchTrigger,
          )
          return typeof dispose === 'function' ? dispose : function () {}
        })
      }

      var shortcuts = null
      try {
        shortcuts = ctx.shortcuts || (typeof ctx.get === 'function' ? ctx.get('shortcuts') : undefined)
      } catch (error) {
        shortcuts = null
      }

      var commandDisposer = registerOpenCommand(shortcuts, translator, controller)
      if (commandDisposer) {
        if (typeof ctx.effect === 'function') {
          ctx.effect(function () {
            return commandDisposer
          }, 'dsh-session-page-search: open command')
        }
      } else if (typeof ctx.inject === 'function') {
        // The service can arrive after this plugin, the optional injection
        // registers the command once it does.
        try {
          ctx.inject(['shortcuts'], function (inner) {
            var resolved = null
            try {
              resolved = inner.shortcuts || (typeof inner.get === 'function' ? inner.get('shortcuts') : undefined)
            } catch (error) {
              resolved = null
            }
            var dispose = registerOpenCommand(resolved, translator, controller)
            if (!dispose) return
            var owner = typeof inner.effect === 'function' ? inner : ctx
            if (typeof owner.effect === 'function') {
              owner.effect(function () {
                return dispose
              }, 'dsh-session-page-search: open command')
            }
          })
        } catch (error) {
          // Ignore, the DOM fallback below still offers the gesture.
        }
      }

      // Always bind the DOM gesture too. On Desktop Windows/macOS a bound
      // command is consumed natively before any DOM event is delivered, so this
      // listener stays dormant there, everywhere else — a profile whose
      // shortcuts service cannot be updated, or a browser tab — it is what
      // guarantees Ctrl/Cmd+F opens the bar.
      var onKeyDown = function (event) {
        if (event.defaultPrevented || event.repeat) return
        if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
        var key = String(event.key || '').toLowerCase()
        if (key !== 'f' && event.code !== 'KeyF') return
        try {
          if (document.querySelector('[aria-modal="true"]') !== null) return
        } catch (error) {
          // A missing modal check must not disable the gesture.
        }
        event.preventDefault()
        controller.open()
      }
      document.addEventListener('keydown', onKeyDown, true)
      if (typeof ctx.effect === 'function') {
        ctx.effect(function () {
          return function () {
            document.removeEventListener('keydown', onKeyDown, true)
          }
        }, 'dsh-session-page-search: open gesture')
      }

      try {
        console.log(
          '[dsh-session-page-search] ready · shortcut command ' +
            (commandDisposer ? 'registered' : 'unavailable, DOM fallback active'),
        )
      } catch (error) {
        // A logging failure is never fatal.
      }
    }

    return {
      inject: ['slots', 'shortcuts', 'locale'],
      apply: apply,
    }
  },
})

