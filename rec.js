(function () {
    'use strict';

    // Lampa «Подборки» v3
    // Сверено с исходниками yumata/lampa-source (Lampa 3.x) и проверено на lampa.mx

    if (window.rec_plugin_ready) return;
    window.rec_plugin_ready = true;

    var COMPONENT = 'rec_home';
    var VERSION = '3.0.0';

    var ICON = '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<rect x="3" y="4" width="18" height="4" rx="1" fill="currentColor"/>' +
        '<rect x="3" y="10" width="12" height="4" rx="1" fill="currentColor"/>' +
        '<rect x="3" y="16" width="18" height="4" rx="1" fill="currentColor"/></svg>';

    // ---------- TMDB ----------

    // Свой ключ из настроек, иначе встроенный ключ Lampa
    function apiKey() {
        var own = (Lampa.Storage.get('rec_tmdb_key', '') + '').trim();
        if (own) return own;
        return Lampa.TMDB && Lampa.TMDB.key ? Lampa.TMDB.key() : '';
    }

    function cubDomain() {
        return (Lampa.Manifest && Lampa.Manifest.cub_domain) || 'cub.best';
    }

    function addQuery(u, q) {
        return u + (u.indexOf('?') >= 0 ? '&' : '?') + q;
    }

    function isDirectTmdb(u) {
        return /\/\/(api|image)\.(themoviedb|tmdb)\.org\//.test(u);
    }

    // Прямой TMDB из России недоступен, поэтому порядок такой:
    // 1) прокси из настроек Lampa (если задан), 2) прокси CUB, 3) прямой TMDB
    function apiCandidates(path) {
        var list = [];
        if (Lampa.TMDB && Lampa.TMDB.api) {
            var own = Lampa.TMDB.api(path);
            if (!isDirectTmdb(own)) list.push(own);
        }
        list.push('https://apitmdb.' + cubDomain() + '/3/' + path);
        list.push('https://api.themoviedb.org/3/' + path);
        return list;
    }

    function imgCandidates(path) {
        var p = 't/p/w342/' + path.replace(/^\//, '');
        var list = [];
        if (Lampa.TMDB && Lampa.TMDB.image) {
            var own = Lampa.TMDB.image(p);
            if (!isDirectTmdb(own)) list.push(own);
        }
        list.push('https://imagetmdb.com/' + p);
        list.push('https://imagetmdb.' + cubDomain() + '/' + p);
        list.push('https://nl.imagetmdb.com/' + p);
        list.push('https://image.tmdb.org/' + p);
        return list;
    }

    // Источник для открытия карточки: 'tmdb' грузит её напрямую с TMDB (в РФ зависает),
    // 'cub' — через сервер Lampa. tmdb берём, только если в Lampa настроен свой прокси TMDB
    function cardSource() {
        if (Lampa.TMDB && Lampa.TMDB.api && !isDirectTmdb(Lampa.TMDB.api('movie/1'))) return 'tmdb';
        return 'cub';
    }

    // Запоминаем, какой вариант сработал, чтобы не перебирать каждый раз
    var goodApi = 0;
    var goodImg = 0;

    function tmdb(path, params, cb) {
        var q = ['api_key=' + encodeURIComponent(apiKey()), 'language=ru-RU'];
        Object.keys(params || {}).forEach(function (k) {
            q.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
        });

        var urls = apiCandidates(path);
        var order = [goodApi].concat(urls.map(function (u, i) { return i; }).filter(function (i) { return i !== goodApi; }));

        function attempt(n) {
            if (n >= order.length) {
                console.log('[rec]', 'tmdb failed', path);
                return cb([]);
            }

            var idx = order[n];
            var net = new Lampa.Reguest();
            net.timeout(8000);
            net.silent(addQuery(urls[idx], q.join('&')), function (j) {
                goodApi = idx;
                cb(j && j.results ? j.results : []);
            }, function () {
                attempt(n + 1);
            });
        }

        attempt(0);
    }

    // Картинка с перебором зеркал при ошибке
    function setPoster(img, path) {
        var urls = imgCandidates(path);
        var order = [goodImg].concat(urls.map(function (u, i) { return i; }).filter(function (i) { return i !== goodImg; }));
        var n = 0;

        img.onload = function () { goodImg = order[n]; };
        img.onerror = function () {
            n++;
            if (n < order.length) img.src = urls[order[n]];
            else img.remove();
        };
        img.src = urls[order[0]];
    }

    // ---------- История ----------

    function isTv(card) {
        return !!(card.number_of_seasons || card.first_air_date || card.media_type === 'tv' || (card.name && !card.title));
    }

    function history() {
        try {
            var list = Lampa.Favorite.get({ type: 'history' }) || [];
            return list.filter(function (c) {
                return c && c.id && (!c.source || c.source === 'tmdb' || c.source === 'cub');
            });
        } catch (e) {
            console.log('[rec]', 'history error', e);
            return [];
        }
    }

    // ---------- Ряды ----------

    function buildRows() {
        var rows = [];
        var hist = history();
        var seen = {};

        hist.forEach(function (c) { seen[c.id] = true; });

        // «Потому что вы смотрели …» по трём последним тайтлам
        hist.slice(0, 3).forEach(function (card) {
            var method = isTv(card) ? 'tv' : 'movie';
            rows.push({
                title: 'Потому что вы смотрели «' + (card.title || card.name) + '»',
                load: function (cb) {
                    tmdb(method + '/' + card.id + '/recommendations', {}, function (items) {
                        cb(items.filter(function (m) { return !seen[m.id]; }));
                    });
                }
            });
        });

        rows.push({
            title: 'Тренды недели',
            load: function (cb) {
                tmdb('trending/all/week', {}, function (items) {
                    cb(items.filter(function (m) { return m.media_type === 'movie' || m.media_type === 'tv'; }));
                });
            }
        });

        rows.push({
            title: 'Лучшее по рейтингу',
            load: function (cb) {
                tmdb('discover/movie', { sort_by: 'vote_average.desc', 'vote_count.gte': 2000 }, cb);
            }
        });

        rows.push({
            title: 'Под настроение: комедии',
            load: function (cb) {
                tmdb('discover/movie', { with_genres: 35, sort_by: 'popularity.desc', 'vote_count.gte': 300 }, cb);
            }
        });

        rows.push({
            title: 'Под настроение: напряжённые триллеры',
            load: function (cb) {
                tmdb('discover/movie', { with_genres: 53, sort_by: 'popularity.desc', 'vote_count.gte': 300 }, cb);
            }
        });

        rows.push({
            title: 'Популярные сериалы',
            load: function (cb) {
                tmdb('tv/popular', {}, cb);
            }
        });

        return rows;
    }

    // ---------- Экран ----------

    function Component() {
        var _this = this;
        var scroll = new Lampa.Scroll({ mask: true, over: true, step: 300 });
        var html = $('<div class="rec-home"></div>');
        var last = false;

        function openCard(m) {
            Lampa.Activity.push({
                url: '',
                component: 'full',
                id: m.id,
                method: isTv(m) ? 'tv' : 'movie',
                card: m,
                source: cardSource()
            });
        }

        function makeCard(m, line, box) {
            var title = m.title || m.name || '';
            var year = ((m.release_date || m.first_air_date || '') + '').slice(0, 4);
            var vote = m.vote_average ? m.vote_average.toFixed(1) : '';

            var card = $('<div class="rec-card selector">' +
                '<div class="rec-card__img"><img /></div>' +
                (vote ? '<div class="rec-card__vote"></div>' : '') +
                '<div class="rec-card__title"></div>' +
                '<div class="rec-card__year"></div>' +
                '</div>');

            setPoster(card.find('img')[0], m.poster_path);
            card.find('.rec-card__title').text(title);
            card.find('.rec-card__year').text(year);
            card.find('.rec-card__vote').text(vote);

            card.on('hover:focus', function () {
                last = card[0];
                // Вертикально: держим ряд в зоне видимости
                scroll.update(line, true);
                // Горизонтально: подкручиваем ряд к карточке
                var b = box[0];
                var left = card[0].offsetLeft - b.offsetLeft - 40;
                b.scrollLeft = Math.max(0, left);
            });

            card.on('hover:enter', function () {
                openCard(m);
            });

            return card;
        }

        // Обновить список фокусируемых элементов, если экран активен
        function refreshController() {
            var active = Lampa.Activity.active();
            if (!active || active.activity !== _this.activity) return;
            if (Lampa.Controller.enabled().name !== 'content') return;

            Lampa.Controller.collectionSet(html);
            if (!last) Lampa.Controller.collectionFocus(false, html);
        }

        this.create = function () {
            var rows = buildRows();
            var pending = rows.length;

            if (this.activity) this.activity.loader(true);

            scroll.minus();
            html.append(scroll.render());

            rows.forEach(function (row) {
                var line = $('<div class="rec-row"><div class="rec-row__title"></div><div class="rec-row__items"></div></div>');
                var box = line.find('.rec-row__items');

                line.find('.rec-row__title').text(row.title);
                scroll.append(line[0]);

                row.load(function (items) {
                    var list = items.filter(function (m) { return m.poster_path; }).slice(0, 20);

                    if (!list.length) line.remove();
                    else list.forEach(function (m) { box.append(makeCard(m, line, box)); });

                    pending--;
                    if (pending <= 0 && _this.activity) _this.activity.loader(false);

                    refreshController();
                });
            });

            return this.render();
        };

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(html);
                    Lampa.Controller.collectionFocus(last || false, html);
                },
                up: function () {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: function () {
                    Navigator.move('down');
                },
                left: function () {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                right: function () {
                    Navigator.move('right');
                },
                back: function () {
                    Lampa.Activity.backward();
                }
            });

            Lampa.Controller.toggle('content');
        };

        this.render = function () {
            return html;
        };

        this.pause = function () {};
        this.stop = function () {};

        this.destroy = function () {
            scroll.destroy();
            html.remove();
        };
    }

    // ---------- Подключение ----------

    function addStyles() {
        var css =
            '.rec-home{padding:1.5em 0}' +
            '.rec-row{margin:0 0 2em 0}' +
            '.rec-row__title{font-size:1.5em;font-weight:600;margin:0 0 .6em 1.5em}' +
            '.rec-row__items{display:flex;overflow-x:auto;overflow-y:hidden;padding:.6em 1.5em;scrollbar-width:none}' +
            '.rec-row__items::-webkit-scrollbar{display:none}' +
            '.rec-card{position:relative;flex:0 0 auto;width:11em;margin-right:1em;transition:transform .15s}' +
            '.rec-card__img{width:100%;padding-top:150%;position:relative;border-radius:.6em;overflow:hidden;background:rgba(255,255,255,.08)}' +
            '.rec-card__img img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}' +
            '.rec-card__vote{position:absolute;top:.5em;right:.5em;background:rgba(0,0,0,.75);padding:.15em .45em;border-radius:.3em;font-size:.85em}' +
            '.rec-card__title{margin-top:.5em;font-size:1em;line-height:1.2;max-height:2.4em;overflow:hidden}' +
            '.rec-card__year{opacity:.5;font-size:.85em;margin-top:.2em}' +
            '.rec-card.focus{transform:scale(1.06)}' +
            '.rec-card.focus .rec-card__img{box-shadow:0 0 0 .2em #fff}';

        $('body').append('<style id="rec-plugin-style">' + css + '</style>');
    }

    function addSettings() {
        Lampa.SettingsApi.addComponent({
            component: 'rec_settings',
            name: 'Подборки',
            icon: ICON
        });

        // values: '' обязателен для type: 'input' — без него Lampa падает при открытии раздела
        Lampa.SettingsApi.addParam({
            component: 'rec_settings',
            param: {
                name: 'rec_tmdb_key',
                type: 'input',
                values: '',
                default: '',
                placeholder: 'Не задан — используется ключ Lampa'
            },
            field: {
                name: 'Свой TMDB API ключ (v3)',
                description: 'Необязательно. Короткий ключ из themoviedb.org/settings/api'
            }
        });
    }

    function addMenu() {
        Lampa.Menu.addButton(ICON, 'Подборки', function () {
            Lampa.Activity.push({ url: '', title: 'Подборки', component: COMPONENT, page: 1 });
        });
    }

    function init() {
        try {
            addStyles();
            Lampa.Component.add(COMPONENT, Component);
            addSettings();
            addMenu();
            console.log('[rec]', 'loaded', VERSION);
        } catch (e) {
            console.log('[rec]', 'init error', e);
            if (Lampa.Noty) Lampa.Noty.show('Подборки: ошибка запуска — ' + e.message);
        }
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', function (e) {
        if (e.type === 'ready') init();
    });
})();
