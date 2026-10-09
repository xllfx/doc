/* ============================================================
   文档下载站 · 提取码门禁 —— ljats 版
   网关：https://ljats.cbflf.cn（已验证可用）
   ------------------------------------------------------------
   流程：
     用户扫码 → 雷静爱探索 pages/details/details?tid=9999
             → 服务端生成 5 位码（2大写字母+3数字，30分钟有效）
     回到本站 → 输入码 → 调用 /App/zm/xqlist 验证
             → 通过 {ok:1} → 放行下载
   ============================================================ */
(function () {
    'use strict';

    var GATE = {
        /* ★ 签发校验接口（已 curl 验证通过） */
        api: 'https://ljats.cbflf.cn/App/zm/xqlist?checkcode=1&key=XLLFX2026CODEKEY',

        /* ★ 小程序码：指向「雷静爱探索」pages/details/details?tid=9999
             生成后把图片放进本站目录，改这里的路径 */
        qrcode: 'https://cdn.jsdelivr.net/gh/xllfx/images@main/qrcode9999.png',

        title: '需要提取码',
        desc: '请用微信扫描下方二维码，获取 5 位提取码',

        /* 全站强制校验 */
        force: true,

        /* 会话内已通过就不再重复询问 */
        remember: true,

        /* 超时毫秒数 */
        timeout: 8000,

        /* ★ 关键：失败是否放行。文档站必须为 false，
                  否则随便输 5 个字符就能下载 */
        failOpen: false,
    };

    var passed = false;

    function injectCss() {
        if (document.getElementById('doc-gate-css')) return;
        var css =
            '.doc-mask{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);' +
            'display:flex;align-items:center;justify-content:center;padding:20px;' +
            'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}' +
            '.doc-box{background:#fff;border-radius:16px;width:100%;max-width:350px;' +
            'padding:26px 22px;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.25)}' +
            '.doc-box h3{margin:0 0 8px;font-size:17px;color:#111;font-weight:600}' +
            '.doc-box p{margin:0 0 16px;font-size:13px;color:#666;line-height:1.6}' +
            '.doc-qr{width:160px;height:160px;margin:0 auto 14px;display:block;border-radius:10px}' +
            '.doc-in{width:100%;height:46px;border:1px solid #dcdcdc;border-radius:10px;' +
            'font-size:22px;text-align:center;letter-spacing:3px;outline:none;box-sizing:border-box;' +
            'margin-bottom:12px;color:#111;text-transform:uppercase}' +
            '.doc-in:focus{border-color:#7c5cff}' +
            '.doc-btn{width:100%;height:46px;border:none;border-radius:10px;' +
            'background:linear-gradient(135deg,#667eea,#7c5cff);color:#fff;font-size:15px;' +
            'cursor:pointer;font-weight:500}' +
            '.doc-btn:disabled{opacity:.6;cursor:not-allowed}' +
            '.doc-msg{margin-top:10px;font-size:12px;color:#e5484d;min-height:16px}' +
            '.doc-tip{margin-top:12px;font-size:11px;color:#aaa;line-height:1.5}' +
            '.doc-close{margin-top:12px;font-size:13px;color:#999;cursor:pointer;background:none;border:none}';
        var s = document.createElement('style');
        s.id = 'doc-gate-css';
        s.textContent = css;
        document.head.appendChild(s);
    }

    function showDialog(onPass) {
        injectCss();

        var mask = document.createElement('div');
        mask.className = 'doc-mask';
        mask.innerHTML =
            '<div class="doc-box">' +
                '<h3>' + GATE.title + '</h3>' +
                '<p>' + GATE.desc + '</p>' +
                '<img class="doc-qr" src="' + GATE.qrcode + '" alt="小程序码" onerror="this.style.display=\'none\'">' +
                '<input class="doc-in" type="text" autocomplete="off" maxlength="5" placeholder="5位码">' +
                '<button class="doc-btn">验证并下载</button>' +
                '<div class="doc-msg"></div>' +
                '<div class="doc-tip">微信内可长按二维码识别<br>提取码 30 分钟内有效</div>' +
                '<button class="doc-close">关闭</button>' +
            '</div>';

        document.body.appendChild(mask);

        var input = mask.querySelector('.doc-in');
        var btn   = mask.querySelector('.doc-btn');
        var msg   = mask.querySelector('.doc-msg');

        function close() { mask.remove(); }
        mask.querySelector('.doc-close').onclick = close;
        mask.addEventListener('click', function (e) { if (e.target === mask) close(); });

        /* 失败处理：绝不放行 */
        function fail(txt) {
            btn.disabled = false;
            btn.textContent = '验证并下载';
            msg.textContent = txt || '提取码错误或已过期，请重新扫码获取';
        }

        function submit() {
            var code = (input.value || '').trim().toUpperCase();
            if (!code) { msg.textContent = '请先输入提取码'; return; }

            btn.disabled = true;
            btn.textContent = '验证中...';
            msg.textContent = '';

            var done = false;
            var timer = setTimeout(function () {
                if (done) return;
                done = true;
                if (GATE.failOpen) { passed = true; close(); onPass && onPass(code); }
                else fail('验证超时，请检查网络后重试');
            }, GATE.timeout);

            fetch(GATE.api + '&code=' + encodeURIComponent(code) + '&_=' + Date.now(),
                  { method: 'GET', cache: 'no-store', mode: 'cors' })
                .then(function (r) { return r.json(); })
                .then(function (j) {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    if (j && j.ok === 1) {
                        passed = true;
                        close();
                        onPass && onPass(code);
                    } else {
                        fail();
                        input.value = '';
                        input.focus();
                    }
                })
                .catch(function () {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    if (GATE.failOpen) { passed = true; close(); onPass && onPass(code); }
                    else fail('网络异常，请稍后重试');
                });
        }

        btn.onclick = submit;
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
        setTimeout(function () { input.focus(); }, 100);
    }

    window.DocGate = {
        need: function () { return GATE.force; },
        passed: function () { return GATE.remember && passed; },
        verify: function (onPass) { showDialog(onPass); },
        cfg: GATE,
    };
})();
