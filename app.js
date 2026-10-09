/* ============================================================
   文档下载站 · 主逻辑
   ------------------------------------------------------------
   数据源：
     data/articles.json  文章（只有摘要，不含全文和明文下载地址）
     data/site.json      轮播图 + 滚动公告 + 站点信息
   验证：lockgate.js 提供 DocGate.verify()
   ============================================================ */
(function () {
    'use strict';

    var DATA = { articles: [], categories: [], site: {} };
    var SITE = { banners: [], notices: [], links: [], bannerOn: 1, noticeOn: 1, bannerInterval: 4000 };
    var curCat = '全部';
    var keyword = '';
    var curPage = 1;

    /* ---------- 解密下载地址（XOR + Base64） ---------- */
    var KEY = 'DOC2026SITEKEY';
    function decrypt(enc) {
        try {
            var raw = atob(enc);
            var out = '';
            for (var i = 0; i < raw.length; i++) {
                out += String.fromCharCode(raw.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length));
            }
            return out;
        } catch (e) {
            return '';
        }
    }

    /* ---------- 工具 ---------- */
    function el(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function fmtIcon(fmt) {
        var m = { 'PDF': '📕', 'DOCX': '📘', 'XLSX': '📗', 'PPTX': '📙', 'TXT': '📄', 'ZIP': '🗜' };
        return m[String(fmt).toUpperCase()] || '📄';
    }

    /* ---------- 右侧图标 ---------- */
    var DL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" ' +
                 'stroke-linecap="round" stroke-linejoin="round">' +
                 '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/></svg>';
    var EYE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
                  'stroke-linecap="round" stroke-linejoin="round">' +
                  '<path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12z"/>' +
                  '<circle cx="12" cy="12" r="3.2"/></svg>';

    /* ---------- 50×50 格式图标（无封面时用） ---------- */
    function fmtIconSvg(fmt) {
        var f = String(fmt || '').toUpperCase();
        var map = {
            'PDF':  { a: '#e5484d', b: '#ff8a80' },
            'DOCX': { a: '#2b5fd9', b: '#6d9bf5' },
            'DOC':  { a: '#2b5fd9', b: '#6d9bf5' },
            'XLSX': { a: '#18a058', b: '#4fd68a' },
            'XLS':  { a: '#18a058', b: '#4fd68a' },
            'PPTX': { a: '#d46b08', b: '#ffb35c' },
            'PPT':  { a: '#d46b08', b: '#ffb35c' },
            'TXT':  { a: '#64748b', b: '#9aa5b5' },
            'ZIP':  { a: '#8e44ad', b: '#bb7bee' },
            'RAR':  { a: '#8e44ad', b: '#bb7bee' }
        };
        var s = map[f] || { a: '#7c5cff', b: '#a991ff' };
        var label = f || 'DOC';
        var gid = 'g' + label.replace(/[^A-Z0-9]/g, '');
        var fs = label.length >= 5 ? 8 : (label.length === 4 ? 10 : 13);
        return '<svg viewBox="0 0 50 50" width="50" height="50" xmlns="http://www.w3.org/2000/svg">' +
            '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0" stop-color="' + s.a + '"/><stop offset="1" stop-color="' + s.b + '"/>' +
            '</linearGradient></defs>' +
            '<rect x="0" y="0" width="50" height="50" rx="11" fill="url(#' + gid + ')"/>' +
            '<path d="M13 7 h15 l9 9 v27 a2 2 0 0 1 -2 2 H13 a2 2 0 0 1 -2 -2 V9 a2 2 0 0 1 2 -2 z" ' +
                'fill="#fff" opacity=".95"/>' +
            '<path d="M28 7 v9 h9" fill="#fff" opacity=".95"/>' +
            '<path d="M28 7 v9 h9 l-9 -9 z" fill="' + s.a + '" opacity=".22"/>' +
            '<text x="25" y="41" text-anchor="middle" font-size="' + fs + '" ' +
                'font-family="Arial,Helvetica,sans-serif" font-weight="700" fill="' + s.a + '">' +
                label + '</text>' +
            '</svg>';
    }
    /* 标记定义：优先用后台自定义（SITE.marks），没有则回落默认 */
    function markDefs() {
        if (SITE && SITE.marks && SITE.marks.length) return SITE.marks;
        return [
            { key: 'pinned', name: '置顶', color: '#e5484d', bg: '#fff1f0' },
            { key: 'hot',    name: '热门', color: '#d46b08', bg: '#fff7e6' }
        ];
    }
    /* 取文章的标记 key 数组（兼容旧布尔字段） */
    function marksOf(a) {
        if (a.marks && a.marks.length) return a.marks;
        var m = [];
        if (a.pinned) m.push('pinned');
        if (a.hot)    m.push('hot');
        return m;
    }
    /* 旧版兼容：给单个文字标签一个类名 */
    function tagClass(t) {
        var defs = markDefs();
        for (var i = 0; i < defs.length; i++) {
            if (defs[i].name === t) return 'tag';
        }
        if (t === '热门') return 'tag hot';
        if (t === '新上架') return 'tag new';
        return 'tag';
    }
    /* 渲染标记徽章：按后台定义着色 */
    function markBadges(a) {
        var defs = markDefs();
        var mk = marksOf(a);
        var out = '';
        defs.forEach(function (d) {
            if (mk.indexOf(d.key) > -1) {
                out += '<span class="tag" style="color:' + esc(d.color) +
                       ';background:' + esc(d.bg) + '">' + esc(d.name) + '</span>';
            }
        });
        return out;
    }
    /* 额外标签：tags 里不属于任何自定义标记的部分，仍以默认样式显示 */
    function extraTags(a) {
        var defs = markDefs();
        var names = defs.map(function (d) { return d.name; });
        return (a.tags || []).filter(function (t) {
            return names.indexOf(t) === -1;
        }).map(function (t) {
            return '<span class="tag">' + esc(t) + '</span>';
        }).join('');
    }

    /* ---------- 网盘预设 ---------- */
    var PANS = {
        quark:    { name: '夸克网盘', icon: '⚡', color: '#4a6cf7' },
        baidu:    { name: '百度网盘', icon: '🐼', color: '#3b7cf7' },
        xunlei:   { name: '迅雷网盘', icon: '⚓', color: '#2f81f7' },
        '123':    { name: '123云盘',  icon: '🔢', color: '#3aa0f7' },
        aliyun:   { name: '阿里云盘', icon: '☁️', color: '#f59e0b' },
        uc:       { name: 'UC网盘',   icon: '🅤', color: '#f97316' },
        tianyi:   { name: '天翼云盘', icon: '📡', color: '#2563eb' },
        lanzou:   { name: '蓝奏云',   icon: '💠', color: '#38bdf8' },
        weiyun:   { name: '微云',     icon: '🐧', color: '#22c55e' },
        caiyun:   { name: '移动云',   icon: '📶', color: '#06b6d4' },
        onedrive: { name: 'OneDrive', icon: '🗂', color: '#0ea5e9' },
        google:   { name: 'Google',   icon: '🌐', color: '#ea4335' },
        magnet:   { name: '磁力链接', icon: '🧲', color: '#8b5cf6' },
        ed2k:     { name: '电驴链接', icon: '🔗', color: '#a855f7' },
        direct:   { name: '直链下载', icon: '⬇️', color: '#18a058' }
    };
    function panInfo(p, link) {
        if (p) {
            var k = String(p).toLowerCase();
            if (PANS[k]) return PANS[k];
        }
        var u = String(link || '');
        if (u.indexOf('quark.cn') > -1) return PANS.quark;
        if (u.indexOf('baidu.com') > -1) return PANS.baidu;
        if (u.indexOf('123pan') > -1) return PANS['123'];
        if (u.indexOf('aliyun') > -1) return PANS.aliyun;
        if (u.indexOf('lanzou') > -1) return PANS.lanzou;
        if (u.indexOf('xunlei') > -1) return PANS.xunlei;
        if (u.indexOf('magnet:') === 0) return PANS.magnet;
        if (u.indexOf('ed2k:') === 0) return PANS.ed2k;
        return { name: '下载地址', icon: '📦', color: '#7c5cff' };
    }
    /* 统一取网盘列表（兼容 pans 数组和旧的 linkEnc） */
    function pansOf(a) {
        var out = [];
        if (a.pans && a.pans.length) {
            a.pans.forEach(function (p) {
                out.push({ pan: p.pan, link: decrypt(p.linkEnc || ''), code: p.code || '' });
            });
        } else if (a.linkEnc) {
            out.push({ pan: '', link: decrypt(a.linkEnc), code: a.code || '' });
        }
        return out.filter(function (x) { return x.link; });
    }

    /* ============================================================
       轮播图
       ============================================================ */
    var bIdx = 0, bTimer = null;

    function renderBanner() {
        var box = el('bannerMod');
        if (!SITE.bannerOn || !SITE.banners || !SITE.banners.length) {
            box.style.display = 'none';
            return;
        }
        box.style.display = '';

        var track = el('bannerTrack');
        var dots = el('bannerDots');
        track.innerHTML = '';
        dots.innerHTML = '';

        SITE.banners.forEach(function (b, i) {
            var tag = b.link ? 'a' : 'div';
            var d = document.createElement(tag);
            d.className = 'banner-item';
            if (b.link) { d.href = b.link; d.target = '_blank'; d.rel = 'noopener'; }
            var bg = b.img
                ? 'background-image:url(' + b.img + ')'
                : 'background:' + (b.bg || 'linear-gradient(120deg,#667eea,#764ba2)');
            d.setAttribute('style', bg);
            d.innerHTML =
                '<div class="banner-txt">' +
                    '<h3>' + esc(b.title) + '</h3>' +
                    '<p>' + esc(b.desc) + '</p>' +
                '</div>' +
                (b.emoji ? '<div class="banner-emoji">' + esc(b.emoji) + '</div>' : '');
            track.appendChild(d);

            var dot = document.createElement('i');
            if (i === 0) dot.className = 'on';
            dot.onclick = function () { goBanner(i); };
            dots.appendChild(dot);
        });

        function goBanner(n) {
            var len = SITE.banners.length;
            bIdx = (n + len) % len;
            track.style.transform = 'translateX(-' + (bIdx * 100) + '%)';
            var ds = dots.querySelectorAll('i');
            for (var k = 0; k < ds.length; k++) ds[k].className = (k === bIdx ? 'on' : '');
            restartTimer();
        }
        function restartTimer() {
            if (bTimer) clearInterval(bTimer);
            if (SITE.banners.length < 2) return;
            bTimer = setInterval(function () { goBanner(bIdx + 1); },
                parseInt(SITE.bannerInterval, 10) || 4000);
        }

        el('bannerPrev').onclick = function () { goBanner(bIdx - 1); };
        el('bannerNext').onclick = function () { goBanner(bIdx + 1); };
        var wrap = box.querySelector('.banner-wrap');
        wrap.onmouseenter = function () { if (bTimer) clearInterval(bTimer); };
        wrap.onmouseleave = function () { restartTimer(); };

        goBanner(0);
    }

    /* ============================================================
       滚动公告
       ============================================================ */
    function renderNotice() {
        var box = el('noticeMod');
        var list = (SITE.notices || []).filter(function (n) { return n && n.text; });
        if (!SITE.noticeOn || !list.length) {
            box.style.display = 'none';
            return;
        }
        box.style.display = '';

        var ul = el('noticeList');
        ul.innerHTML = '';

        function addItem(n) {
            var li = document.createElement('li');
            if (n.link) {
                var a = document.createElement('a');
                a.href = n.link;
                a.target = '_blank';
                a.rel = 'noopener';
                a.textContent = n.text;
                li.appendChild(a);
            } else {
                li.textContent = n.text;
            }
            ul.appendChild(li);
        }
        /* 渲染两遍，实现无缝循环 */
        list.forEach(addItem);
        list.forEach(addItem);

        var H = 26, i = 0;
        if (list.length < 2) return;
        setInterval(function () {
            i++;
            ul.style.transition = 'transform .5s ease';
            ul.style.transform = 'translateY(-' + (i * H) + 'px)';
            if (i >= list.length) {
                setTimeout(function () {
                    ul.style.transition = 'none';
                    ul.style.transform = 'translateY(0)';
                    i = 0;
                }, 520);
            }
        }, 3000);
    }

    /* ---------- 友情链接（后台可增删，没数据则整块隐藏） ---------- */
    function renderLinks() {
        var mod  = el('linksMod');
        var box  = el('linkList');
        if (!mod || !box) return;

        var list = (SITE.links || []).filter(function (l) {
            return l && l.name && l.url;
        });

        if (!list.length) { mod.style.display = 'none'; box.innerHTML = ''; return; }

        var html = '';
        list.forEach(function (l) {
            html += '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' +
                    esc(l.name) + '</a>';
        });
        box.innerHTML = html;
        mod.style.display = '';
        syncFootSpace();
    }

    /* 友情链接：已物理放进 .foot-inner，随页脚一起固定吸底，无需 JS 定位 */
    function layoutLinks() { syncFootSpace(); }

    /* 页脚变高后同步 body 底部留白，避免遮挡最后一条内容 */
    function syncFootSpace() {
        var foot = document.querySelector('.foot');
        if (!foot) return;
        var fixed = getComputedStyle(foot).position === 'fixed';
        if (!fixed) { document.body.style.paddingBottom = '0px'; return; }
        var h = foot.getBoundingClientRect().height;
        document.body.style.paddingBottom = (Math.round(h) + 24) + 'px';
    }

    /* ---------- 站点信息 + 备案号 ---------- */
    function applySite(s) {
        if (!s) return;
        if (s.name) {
            el('siteName').textContent = s.name;
            document.title = s.name + ' - 求知探索 乐于分享';
        }
        if (s.contact) el('footContact').textContent = '联系：' + s.contact;

        /* 备案号：后台填了才显示，没填整块隐藏 */
        var box = el('footBeian');
        if (!box) return;
        var icp = (s.icp || '').trim();
        var ga  = (s.ga  || '').trim();
        var html = '';
        if (icp) {
            html += '<a href="https://beian.miit.gov.cn" target="_blank" rel="noopener">' +
                    esc(icp) + '</a>';
        }
        if (ga) {
            html += '<span class="gp"><a href="https://www.beian.gov.cn" target="_blank" rel="noopener">' +
                    esc(ga) + '</a></span>';
        }
        if (html) {
            box.innerHTML = html;
            box.classList.add('on');
        } else {
            box.innerHTML = '';
            box.classList.remove('on');
        }
    }

    /* ---------- 白天 / 黑夜切换 ---------- */
    function initTheme() {
        var btn = el('themeBtn');
        if (!btn) return;
        var saved = null;
        try { saved = localStorage.getItem('docTheme'); } catch (e) {}
        if (!saved) {
            saved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
                    ? 'dark' : 'light';
        }
        apply(saved);

        btn.onclick = function () {
            var now = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
            apply(now === 'dark' ? 'light' : 'dark');
        };

        function apply(t) {
            if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
            else document.documentElement.removeAttribute('data-theme');
            try { localStorage.setItem('docTheme', t); } catch (e) {}
        }
    }

    /* ---------- 返回顶部 ---------- */
    function initToTop() {
        var btn = el('toTop');
        if (!btn) return;
        btn.onclick = function () {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };
        function check() {
            if (window.scrollY > 320) btn.classList.add('on');
            else btn.classList.remove('on');
        }
        window.addEventListener('scroll', check, { passive: true });
        check();

        window.addEventListener('resize', syncFootSpace);
    }

    /* ---------- 加载数据 ----------
       注意：必须等 site.json 读完（拿到自定义标记定义）再渲染列表，
       否则标记配色会短暂回落到默认的置顶/热门。 */
    function load() {
        fetch('data/site.json?_=' + Date.now(), { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                SITE = j || SITE;
                applySite(SITE.site);
                renderBanner();
                renderNotice();
                renderLinks();
            })
            .catch(function () {
                el('bannerMod').style.display = 'none';
                el('noticeMod').style.display = 'none';
                el('linksMod').style.display = 'none';
            })
            .then(function () {
                /* 串行：确保 SITE.marks 已就绪 */
                return fetch('data/articles.json?_=' + Date.now(), { cache: 'no-store' });
            })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                DATA = j;
                if (DATA.site && !SITE.site) applySite(DATA.site);
                renderCats();
                renderList();
            })
            .catch(function () {
                el('grid').innerHTML =
                    '<div class="empty" style="grid-column:1/-1">' +
                    '数据加载失败，请通过 http 访问（不要直接双击打开 html 文件）' +
                    '</div>';
            });
    }

    /* ---------- 分类 ---------- */
    function renderCats() {
        var box = el('cats');
        box.innerHTML = '';
        (DATA.categories || ['全部']).forEach(function (c) {
            var d = document.createElement('div');
            d.className = 'cat' + (c === curCat ? ' on' : '');
            d.textContent = c;
            d.onclick = function () {
                curCat = c;
                curPage = 1;
                renderCats();
                renderList();
            };
            box.appendChild(d);
        });
    }

    /* ---------- 列表 ---------- */
    function matched() {
        var kw = keyword.trim().toLowerCase();
        return (DATA.articles || []).filter(function (a) {
            if (curCat !== '全部' && a.cat !== curCat) return false;
            if (!kw) return true;
            return (a.title + ' ' + (a.excerpt || '') + ' ' + (a.cat || '')).toLowerCase().indexOf(kw) > -1;
        }).sort(function (x, y) {
            /* 第一个标记当作「置顶」用于排序 */
            var top = markDefs().length ? markDefs()[0].key : 'pinned';
            var xt = marksOf(x).indexOf(top) > -1 ? 1 : 0;
            var yt = marksOf(y).indexOf(top) > -1 ? 1 : 0;
            if (xt !== yt) return yt - xt;
            return (y.views || 0) - (x.views || 0);
        });
    }

    /* ---------- 每页条数（后台可配，默认 10） ---------- */
    function pageSize() {
        var s = SITE.site || {};
        var n = parseInt(s.pageSize, 10);
        if (!n || n < 1) n = 10;
        if (n > 200) n = 200;
        return n;
    }

    /* ---------- 分页条 ---------- */
    function renderPager(total, pages) {
        var box = el('pager');
        if (!box) return;
        if (pages <= 1) { box.innerHTML = ''; box.style.display = 'none'; return; }
        box.style.display = 'flex';

        var html = '';
        html += '<button class="pg-btn' + (curPage === 1 ? ' dis' : '') + '" data-p="' +
                (curPage - 1) + '"' + (curPage === 1 ? ' disabled' : '') + '>上一页</button>';

        /* 页码按钮：最多显示 7 个，中间用省略号 */
        var nums = [];
        if (pages <= 7) {
            for (var i = 1; i <= pages; i++) nums.push(i);
        } else {
            nums.push(1);
            var s = Math.max(2, curPage - 2);
            var e = Math.min(pages - 1, curPage + 2);
            if (s > 2) nums.push('…');
            for (var j = s; j <= e; j++) nums.push(j);
            if (e < pages - 1) nums.push('…');
            nums.push(pages);
        }
        nums.forEach(function (n) {
            if (n === '…') {
                html += '<span class="pg-ell">…</span>';
            } else {
                html += '<button class="pg-btn' + (n === curPage ? ' on' : '') +
                        '" data-p="' + n + '">' + n + '</button>';
            }
        });

        html += '<button class="pg-btn' + (curPage === pages ? ' dis' : '') + '" data-p="' +
                (curPage + 1) + '"' + (curPage === pages ? ' disabled' : '') + '>下一页</button>';
        html += '<span class="pg-info">第 ' + curPage + ' / ' + pages + ' 页</span>';

        box.innerHTML = html;
        Array.prototype.forEach.call(box.querySelectorAll('.pg-btn'), function (b) {
            b.onclick = function () {
                var p = parseInt(b.getAttribute('data-p'), 10);
                if (!p || p === curPage) return;
                goPage(p);
            };
        });
    }

    function goPage(p) {
        curPage = p;
        renderList();
        var top = el('grid');
        if (top) {
            var y = top.getBoundingClientRect().top + window.scrollY - 90;
            window.scrollTo({ top: y, behavior: 'smooth' });
        }
    }

    function renderList() {
        var all = matched();
        var size = pageSize();
        var pages = Math.max(1, Math.ceil(all.length / size));
        if (curPage > pages) curPage = pages;
        if (curPage < 1) curPage = 1;

        var start = (curPage - 1) * size;
        var list = all.slice(start, start + size);

        el('countText').textContent = '共 ' + all.length + ' 篇文档' +
            (pages > 1 ? '（第 ' + curPage + ' / ' + pages + ' 页）' : '');
        el('empty').style.display = all.length ? 'none' : 'block';

        var box = el('grid');
        box.innerHTML = '';
        list.forEach(function (a) {
            var card = document.createElement('div');
            card.className = 'card' + (marksOf(a).length ? ' pinned' : '');
            var tags = markBadges(a) + extraTags(a);
            var pn = pansOf(a).length;
            var meta = esc(a.size) + (a.pages ? ' · ' + a.pages + '页' : '') +
                       (pn > 1 ? ' · ' + pn + '个网盘' : '');

            /* 封面：有 cover 用图片，否则用格式图标；图片加载失败自动回退图标 */
            var ico = a.cover
                ? '<img src="' + esc(a.cover) + '" alt="">'
                : fmtIconSvg(a.format);

            card.innerHTML =
                '<div class="card-ico">' + ico + '</div>' +
                '<div class="card-main">' +
                    '<div class="card-title-row">' +
                        '<div class="card-title" title="' + esc(a.title) + '">' + esc(a.title) + '</div>' +
                        (tags ? '<span class="card-tags">' + tags + '</span>' : '') +
                    '</div>' +
                    '<div class="card-sub">' +
                        '<span>' + esc(a.date || '') + '</span>' +
                        (meta ? '<span class="card-dot">·</span><span>' + meta + '</span>' : '') +
                    '</div>' +
                '</div>' +
                '<div class="card-right">' +
                    '<span class="card-views">' + EYE_SVG + (a.views || 0) + '</span>' +
                    '<span class="card-dl">点击下载</span>' +
                    '<span class="card-dlicon" title="可下载">' + DL_SVG + '</span>' +
                '</div>';

            if (a.cover) {
                var im = card.querySelector('.card-ico img');
                if (im) im.onerror = function () {
                    this.parentNode.innerHTML = fmtIconSvg(a.format);
                };
            }
            card.onclick = function () { openModal(a); };
            box.appendChild(card);
        });

        renderPager(all.length, pages);
    }

    /* ---------- 弹窗 ---------- */
    var current = null;

    function openModal(a) {
        current = a;
        var body = el('modalBody');
        var tags = markBadges(a) + extraTags(a);
        var pn = pansOf(a).length;

        body.innerHTML =
            '<div class="tags">' + tags + '</div>' +
            '<div class="m-title">' + esc(a.title) + '</div>' +
            '<div class="m-meta">' + esc(a.cat) + ' · ' + esc(a.format) +
                ' · ' + esc(a.size) + ' · ' + (a.pages || 0) + '页 · ' + esc(a.date) +
                (pn > 1 ? ' · ' + pn + '个网盘可选' : '') + '</div>' +
            '<div class="m-excerpt">' + esc(a.excerpt) + '</div>' +
            '<div class="m-lock">' +
                '<div class="m-lock-fake">' +
                    '本文档完整内容包含详细操作步骤、配置示例与常见问题排查。<br>' +
                    '完整版共 ' + (a.pages || 0) + ' 页，需下载后查看。<br>' +
                    '下载方式：扫码获取提取码 → 在本页填写验证 → 获取下载地址。' +
                '</div>' +
                '<div class="m-lock-tip">' +
                    '<strong>🔒 以下内容需下载后查看</strong>' +
                    '<span>共 ' + (a.pages || 0) + ' 页完整内容</span>' +
                '</div>' +
            '</div>' +
            '<button class="m-btn" id="btnGet">📥 获取提取码并下载</button>';

        el('modal').classList.add('on');

        el('btnGet').onclick = function () {
            if (window.DocGate && DocGate.passed && DocGate.passed()) {
                showDownload(a);
                return;
            }
            if (window.DocGate) {
                DocGate.verify(function () { showDownload(a); });
            } else {
                alert('验证模块未加载，请确认 lockgate.js 已引入');
            }
        };
    }

    /* ---------- 验证通过：显示下载地址（支持多网盘切换） ---------- */
    function showDownload(a) {
        var list = pansOf(a);
        var body = el('modalBody');

        if (!list.length) {
            body.insertAdjacentHTML('beforeend',
                '<div class="m-pass"><div class="m-pass-title">✅ 验证通过</div>' +
                '<div style="color:#c00;font-size:13px">该文档暂未配置下载地址</div></div>');
            var b1 = el('btnGet'); if (b1) b1.style.display = 'none';
            return;
        }

        var wrap = document.createElement('div');
        wrap.className = 'm-pass';
        wrap.innerHTML = '<div class="m-pass-title">✅ 验证通过，下载地址已解锁</div>';

        /* 网盘切换按钮 */
        var pansBox = document.createElement('div');
        pansBox.className = 'm-pans';
        wrap.appendChild(pansBox);

        var codeBox = document.createElement('div');
        codeBox.className = 'm-code';
        wrap.appendChild(codeBox);

        var goBtn = document.createElement('a');
        goBtn.className = 'm-gobtn';
        goBtn.target = '_blank';
        goBtn.rel = 'noopener';
        wrap.appendChild(goBtn);

        var copyBtn = document.createElement('button');
        copyBtn.className = 'm-copybtn';
        copyBtn.textContent = '复制链接';
        wrap.appendChild(copyBtn);

        var linkBox = document.createElement('a');
        linkBox.className = 'm-link';
        linkBox.target = '_blank';
        linkBox.rel = 'noopener';
        linkBox.style.marginTop = '10px';
        wrap.appendChild(linkBox);

        body.appendChild(wrap);

        var sel = 0;
        function paint() {
            var p = list[sel];
            var info = panInfo(p.pan, p.link);

            pansBox.innerHTML = '';
            if (list.length > 1) {
                list.forEach(function (x, i) {
                    var xi = panInfo(x.pan, x.link);
                    var btn = document.createElement('button');
                    btn.className = 'pan-btn' + (i === sel ? ' on' : '');
                    btn.innerHTML = '<span>' + xi.icon + '</span><span>' + esc(x.panName || xi.name) + '</span>';
                    btn.onclick = function () { sel = i; paint(); };
                    pansBox.appendChild(btn);
                });
            }

            codeBox.style.display = p.code ? 'flex' : 'none';
            codeBox.innerHTML = p.code
                ? '<b>提取码</b><span class="val">' + esc(p.code) + '</span>'
                : '';

            goBtn.href = p.link;
            goBtn.textContent = '前往 ' + (p.panName || info.name) + ' 领取';
            goBtn.style.background = p.panColor || info.color;

            linkBox.href = p.link;
            linkBox.textContent = p.link;

            copyBtn.onclick = function () {
                var ta = document.createElement('textarea');
                ta.value = p.link;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                try {
                    document.execCommand('copy');
                    copyBtn.textContent = '已复制';
                    setTimeout(function () { copyBtn.textContent = '复制链接'; }, 1500);
                } catch (e) {
                    alert('复制失败，请手动选中复制');
                }
                document.body.removeChild(ta);
            };
        }
        paint();

        var btnGet = el('btnGet');
        if (btnGet) btnGet.style.display = 'none';
    }

    /* ---------- 事件 ---------- */
    function closeModal() { el('modal').classList.remove('on'); }

    el('modalClose').onclick = closeModal;
    el('modal').addEventListener('click', function (e) {
        if (e.target === el('modal')) closeModal();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeModal();
    });

    el('searchBtn').onclick = function () {
        keyword = el('searchInput').value;
        curPage = 1;
        renderList();
    };
    el('searchInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { keyword = el('searchInput').value; curPage = 1; renderList(); }
    });
    el('searchInput').addEventListener('input', function (e) {
        keyword = e.target.value;
        curPage = 1;
        renderList();
    });

    /* ---------- 点击站点名 → 回首页（清空搜索与分类并回到顶部） ---------- */
    var logoEl = el('siteName');
    if (logoEl) {
        logoEl.style.cursor = 'pointer';
        logoEl.title = '返回首页';
        logoEl.onclick = function () {
            keyword = '';
            curCat = '全部';
            if (el('searchInput')) el('searchInput').value = '';
            curPage = 1;
            renderCats();
            renderList();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };
    }

    initTheme();
    initToTop();

    load();
})();

/* ============================================================
   终极对齐锁定（追加）：确保 DOM 归属正确 + 清掉残留内联样式
   ============================================================ */
(function () {
    function lockAlign() {
        var fi = document.querySelector('.foot-inner');
        var lk = document.getElementById('linksMod');
        var bt = document.getElementById('toTop');
        // 友情链接必须在 .foot-inner 内（随 fixed 页脚固定）
        if (fi && lk && lk.parentElement !== fi) {
            fi.insertBefore(lk, fi.firstChild);
        }
        // 清掉可能残留的内联 right（CSS 已用 !important 接管）
        if (bt) { bt.style.right = ''; bt.style.left = ''; bt.style.marginRight = ''; }
        if (lk) { lk.style.position = ''; lk.style.left = ''; lk.style.bottom = '';
                  lk.style.width = ''; lk.style.transform = ''; }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', lockAlign);
    } else { lockAlign(); }
    window.addEventListener('load', lockAlign);
    setTimeout(lockAlign, 800);
})();

/* ============================================================
   终极对齐 v2（追加）：自适应差值校正，不依赖任何预设宽度
   原理：测量「按钮实际右缘」与「卡片右缘」的差值，反向补偿。
   无论包含块是谁、滚动条多宽、主体多宽，都能自动收敛。
   ============================================================ */
/* ===== 页脚高度自适应：友链并入页脚后防止遮挡内容 ===== */

/* ===================================================================
   页脚 fixed 降级修复 —— 自适应自愈脚本
   问题根因：祖先元素存在 transform / filter / backdrop-filter /
   will-change / contain 时，position:fixed 会降级为相对该祖先定位，
   表现为"跟随页面滚动"。
   方案一：自动清除这些破坏性属性，让 fixed 恢复正常；
   方案二：若 CSS 层面清不掉，自动启用 flexmode 三段式布局兜底。
   =================================================================== */
/* ===== 返回顶部按钮：右缘贴主体右端 + 固定悬浮右下角（最终版） ===== */
(function () {
    function place() {
        var b = document.getElementById('toTop');
        if (!b) return;
        var c = document.querySelector('.card') || document.querySelector('.mod');
        var cw = document.documentElement.clientWidth;
        var right = 20;
        if (c) {
            var r = Math.round(cw - c.getBoundingClientRect().right);
            if (r >= 12 && r <= cw / 2) right = r;
        }
        b.style.setProperty('position', 'fixed', 'important');
        b.style.setProperty('right', right + 'px', 'important');
        b.style.setProperty('bottom', '24px', 'important');
        b.style.setProperty('margin-bottom', '0', 'important');
        b.style.setProperty('z-index', '900', 'important');
    }
    function boot() { place(); [80,300,800,1600,3000].forEach(function(t){setTimeout(place,t);}); }
    if (document.readyState === 'complete') { boot(); }
    else { window.addEventListener('load', boot); }
    window.addEventListener('resize', place);
    setTimeout(place, 0);
    if (window.MutationObserver) {
        new MutationObserver(place).observe(document.body, { childList: true, subtree: true });
    }
    window.__btnInfo = function () {
        var R = function (e) { return e ? Math.round(e.getBoundingClientRect().right) : null; };
        var b = document.getElementById('toTop');
        return {
            卡片右缘: R(document.querySelector('.card')),
            按钮右缘: R(b),
            按钮position: b ? getComputedStyle(b).position : null,
            按钮bottom: b ? getComputedStyle(b).bottom : null,
            页脚position: (function(){var f=document.querySelector('.foot');return f?getComputedStyle(f).position:null;})()
        };
    };
})();
/* ===== 返回顶部按钮：右缘贴主体 + 自动避开页脚（滚动/缩放/重绘均重算） ===== */
(function () {
    var GAP = 14;                 // 按钮与页脚顶边的间距
    var IDLE_BOTTOM = 24;         // 页脚不可见时，距视口底部

    function btn() { return document.getElementById('toTop'); }
    function card() { return document.querySelector('.card') || document.querySelector('.mod'); }
    function foot() { return document.querySelector('.foot'); }

    var raf = 0;
    function place() {
        var b = btn();
        if (!b) return;
        if (b.style.display === 'none') return;

        /* ① 水平：右缘精确贴住主体/页脚右端 */
        var cw = document.documentElement.clientWidth;   // 不含滚动条
        var c = card();
        var right = c ? Math.max(12, Math.round(cw - c.getBoundingClientRect().right)) : 20;

        /* ② 垂直：页脚进入视口时，按钮浮到页脚顶边之上（外侧） */
        var bottom = IDLE_BOTTOM;
        var f = foot();
        if (f) {
            var r = f.getBoundingClientRect();
            var vh = window.innerHeight || document.documentElement.clientHeight;
            var topInView = Math.max(0, Math.min(r.top, vh));  // 页脚顶边（限制在视口内）
            var occupy = Math.round(vh - topInView);           // 页脚占据的视口高度
            if (occupy > 8) bottom = occupy + GAP;
        }

        b.style.setProperty('position', 'fixed', 'important');
        b.style.setProperty('right', right + 'px', 'important');
        b.style.setProperty('bottom', bottom + 'px', 'important');
        b.style.setProperty('margin-bottom', '0', 'important');
        b.style.setProperty('z-index', '900', 'important');
    }

    function schedule() {
        if (raf) return;
        raf = requestAnimationFrame(function () { raf = 0; place(); });
    }

    function boot() {
        place();
        [100, 400, 1000, 2000, 3500].forEach(function (t) { setTimeout(place, t); });
    }

    if (document.readyState === 'complete') { boot(); }
    else { window.addEventListener('load', boot); }

    /* ★ 关键：页脚现在是 static，会随滚动移动，必须监听 scroll 重算 */
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    if (window.MutationObserver) {
        new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    }
    place();

    window.__btnInfo = function () {
        var b = btn(), f = foot(), c = card();
        var R = function (e) { return e ? Math.round(e.getBoundingClientRect().right) : null; };
        return {
            卡片右缘: R(c),
            按钮右缘: R(b),
            页脚右缘: R(document.querySelector('.foot-inner')),
            按钮bottom: b ? getComputedStyle(b).bottom : null,
            按钮position: b ? getComputedStyle(b).position : null,
            页脚position: f ? getComputedStyle(f).position : null,
            页脚topInView: f ? Math.round(f.getBoundingClientRect().top) : null,
            视口高: window.innerHeight
        };
    };
})();
/* ===== 返回顶部按钮：与页脚并排，位于页脚右侧外面 ===== */
(function () {
    var BTN_ID = 'toTop';

    function q(s) { return document.querySelector(s); }
    function vw() { return document.documentElement.clientWidth; }
    function vh() { return window.innerHeight; }

    function place() {
        var btn = document.getElementById(BTN_ID);
        if (!btn) return;

        var foot = q('.foot');
        var card = q('.card') || q('.mod') || q('.links-mod');

        var W = vw(), H = vh();
        var fr = foot ? foot.getBoundingClientRect() : null;
        var cr = card ? card.getBoundingClientRect() : null;

        /* ---- 水平：优先放在页脚右缘之外 ---- */
        var gapRight = fr ? Math.round(W - fr.right) : 0;
        var btnW = btn.offsetWidth || 44;

        if (fr && gapRight >= btnW + 12) {
            /* 右侧有空间 → 真正放到页脚外面 */
            btn.style.setProperty('left', Math.round(fr.right + 10) + 'px', 'important');
            btn.style.setProperty('right', 'auto', 'important');
            btn.classList.add('btn-outside');
        } else {
            /* 空间不足 → 右缘对齐页脚/卡片右缘，浮在上层 */
            var edge = fr ? fr.right : (cr ? cr.right : W - 20);
            btn.style.setProperty('right', Math.max(10, Math.round(W - edge)) + 'px', 'important');
            btn.style.setProperty('left', 'auto', 'important');
            btn.classList.remove('btn-outside');
        }

        /* ---- 垂直：与页脚并排（底边对齐页脚底边内侧） ---- */
        var bottom;
        if (fr && fr.top < H - 30 && fr.bottom > 30) {
            /* 页脚在视口内 → 与页脚同高，坐在页脚底部内边距线上 */
            bottom = Math.round(H - fr.bottom) + 14;
            if (bottom < 10) bottom = 10;
        } else {
            /* 页脚不可见 → 回到视口右下角 */
            bottom = 24;
        }
        btn.style.setProperty('bottom', bottom + 'px', 'important');
        btn.style.setProperty('position', 'fixed', 'important');
        btn.style.setProperty('margin-bottom', '0', 'important');
        btn.style.setProperty('z-index', '950', 'important');
    }

    var raf = null;
    function onScroll() {
        if (raf) return;
        raf = requestAnimationFrame(function () { raf = null; place(); });
    }

    function boot() {
        place();
        [100, 300, 800, 1500, 3000].forEach(function (t) { setTimeout(place, t); });
    }

    if (document.readyState === 'complete') { boot(); }
    else { window.addEventListener('load', boot); }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', place);
    if (window.MutationObserver) {
        new MutationObserver(place).observe(document.body, { childList: true, subtree: true });
    }
    place();

    window.__btnInfo = function () {
        var btn = document.getElementById(BTN_ID);
        var foot = q('.foot');
        var card = q('.card') || q('.mod');
        var fi = q('.foot-inner');
        var R = function (e) { return e ? Math.round(e.getBoundingClientRect().right) : null; };
        var r = btn ? btn.getBoundingClientRect() : null;
        var fr = foot ? foot.getBoundingClientRect() : null;
        return {
            '卡片右缘': R(card),
            '页脚右缘': R(foot),
            'foot-inner右缘': R(fi),
            '按钮左缘': r ? Math.round(r.left) : null,
            '按钮右缘': r ? Math.round(r.right) : null,
            '按钮bottom': btn ? getComputedStyle(btn).bottom : null,
            '按钮是否在页脚外': (r && fr) ? (Math.round(r.left) >= Math.round(fr.right) - 1) : null,
            '按钮position': btn ? getComputedStyle(btn).position : null,
            '页脚position': foot ? getComputedStyle(foot).position : null,
            '视口高': window.innerHeight,
            '视口宽': document.documentElement.clientWidth,
            '页脚topInView': fr ? Math.round(fr.top) : null
        };
    };
})();
