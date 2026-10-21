(function () {
    'use strict';

    // Lampa «Подборки» v4 — главная в стиле Apple TV / Netflix
    // Сверено с исходниками yumata/lampa-source (Lampa 3.x) и проверено на lampa.mx
    // Пульт: ←/→ — фильмы, ↑/↓ — категории, OK / тап по постеру — смотреть, долгий OK — карточка Lampa

    if (window.rec_plugin_ready) return;
    window.rec_plugin_ready = true;

    var COMPONENT = 'rec_home';
    var VERSION = '4.1.0';

    var ICON = '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<rect x="3" y="4" width="18" height="4" rx="1" fill="currentColor"/>' +
        '<rect x="3" y="10" width="12" height="4" rx="1" fill="currentColor"/>' +
        '<rect x="3" y="16" width="18" height="4" rx="1" fill="currentColor"/></svg>';

    var GENRES = {
        28: 'Боевик', 12: 'Приключения', 16: 'Мультфильм', 35: 'Комедия', 80: 'Криминал',
        99: 'Документальный', 18: 'Драма', 10751: 'Семейный', 14: 'Фэнтези', 36: 'История',
        27: 'Ужасы', 10402: 'Музыка', 9648: 'Детектив', 10749: 'Мелодрама', 878: 'Фантастика',
        10770: 'ТВ фильм', 53: 'Триллер', 10752: 'Военный', 37: 'Вестерн',
        10759: 'Боевик и приключения', 10762: 'Детский', 10763: 'Новости', 10764: 'Реалити',
        10765: 'Фантастика и фэнтези', 10766: 'Мыльная опера', 10767: 'Ток-шоу', 10768: 'Война и политика'
    };

    // ---------- Сеть ----------

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

    function imgCandidates(path, size) {
        var p = 't/p/' + size + '/' + path.replace(/^\//, '');
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

    // Запоминаем, какой вариант сработал, чтобы не перебирать каждый раз
    var goodApi = 0;
    var goodImg = 0;

    function ordered(len, first) {
        var order = [first < len ? first : 0];
        for (var i = 0; i < len; i++) if (i !== order[0]) order.push(i);
        return order;
    }

    function tmdbJson(path, params, cb) {
        var q = ['api_key=' + encodeURIComponent(apiKey()), 'language=ru-RU'];
        Object.keys(params || {}).forEach(function (k) {
            q.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
        });

        var urls = apiCandidates(path);
        var order = ordered(urls.length, goodApi);

        function attempt(n) {
            if (n >= order.length) {
                console.log('[rec]', 'tmdb failed', path);
                return cb(null);
            }

            var idx = order[n];
            var net = new Lampa.Reguest();
            net.timeout(8000);
            net.silent(addQuery(urls[idx], q.join('&')), function (j) {
                goodApi = idx;
                cb(j);
            }, function () {
                attempt(n + 1);
            });
        }

        attempt(0);
    }

    function tmdb(path, params, cb) {
        tmdbJson(path, params, function (j) {
            cb(j && j.results ? j.results : []);
        });
    }

    // Загрузка картинки с перебором зеркал
    function loadImage(path, size, onload, onfail) {
        var urls = imgCandidates(path, size);
        var order = ordered(urls.length, goodImg);
        var n = 0;
        var img = new Image();

        img.onload = function () {
            goodImg = order[n];
            onload(urls[order[n]]);
        };
        img.onerror = function () {
            n++;
            if (n < order.length) img.src = urls[order[n]];
            else if (onfail) onfail();
        };
        img.src = urls[order[0]];
    }

    function setPoster(img, path) {
        loadImage(path, 'w342', function (url) {
            img.src = url;
            img.className = 'loaded';
        });
    }

    // ---------- Карточки ----------

    function isTv(card) {
        return !!(card.number_of_seasons || card.first_air_date || card.media_type === 'tv' || (card.name && !card.title));
    }

    function yearOf(m) {
        return ((m.release_date || m.first_air_date || '') + '').slice(0, 4);
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

    // Источник для открытия карточки: 'tmdb' грузит её напрямую с TMDB (в РФ зависает),
    // 'cub' — через сервер Lampa. tmdb берём, только если в Lampa настроен свой прокси TMDB
    function cardSource() {
        if (Lampa.TMDB && Lampa.TMDB.api && !isDirectTmdb(Lampa.TMDB.api('movie/1'))) return 'tmdb';
        return 'cub';
    }

    function cardData(m) {
        var data = {};
        for (var k in m) data[k] = m[k];
        data.source = cardSource();
        if (isTv(m)) {
            data.name = m.name || m.title;
            data.original_name = m.original_name || m.original_title;
        } else {
            data.title = m.title || m.name;
            data.original_title = m.original_title || m.original_name;
        }
        return data;
    }

    function openCard(m) {
        Lampa.Activity.push({
            url: '',
            component: 'full',
            id: m.id,
            method: isTv(m) ? 'tv' : 'movie',
            card: cardData(m),
            source: cardSource()
        });
    }

    // ---------- Смотреть ----------

    // Онлайн-плагины регистрируются в Lampa.Manifest.plugins (type: 'video') —
    // тот же механизм, что пункт «Смотреть онлайн» в меню карточки Lampa
    function videoPlugins() {
        var list = (Lampa.Manifest && Lampa.Manifest.plugins) || [];
        if (Object.prototype.toString.call(list) !== '[object Array]') list = [list];
        return list.filter(function (p) {
            return p && p.type === 'video' && typeof p.onContextLauch === 'function';
        });
    }

    function findVideoPlugin() {
        var list = videoPlugins();
        var pref = Lampa.Storage.get('rec_watch_plugin', 'auto');
        var want = pref && pref !== 'auto' ? pref : 'showy_ru_lampac';

        for (var i = 0; i < list.length; i++) {
            if (list[i].component === want) return list[i];
        }
        return list[0] || null;
    }

    // Запасной путь: открыть карточку Lampa и нажать в ней кнопку онлайн-плагина
    // (Showy RU и похожие плагины добавляют её в карточку по событию 'full')
    var pendingWatch = null;

    function watchViaCard(m) {
        pendingWatch = { id: m.id, time: Date.now() };
        openCard(m);
    }

    function onFullReady(e) {
        if (e.type !== 'complite' || !pendingWatch) return;

        var movie = e.data && e.data.movie;
        if (!movie || movie.id != pendingWatch.id || Date.now() - pendingWatch.time > 20000) return;

        pendingWatch = null;

        // Плагины вставляют кнопку в тот же обработчик 'complite' — даём им отработать
        setTimeout(function () {
            var render = e.object && e.object.activity ? e.object.activity.render() : $();
            var btn = render.find('.showy-ru-showy60--button, [class*="view--online"]').first();

            if (btn.length) {
                if (Lampa.Utils && Lampa.Utils.trigger) Lampa.Utils.trigger(btn[0], 'hover:enter');
                else btn.trigger('hover:enter');
            } else {
                Lampa.Noty.show('Кнопка онлайн-плагина не найдена в карточке');
            }
        }, 300);
    }

    function watch(m) {
        var plugin = findVideoPlugin();

        if (!plugin) return watchViaCard(m);

        var data = cardData(m);
        var cancelled = false;

        function launch() {
            if (cancelled) return;
            Lampa.Loading.stop();
            try {
                plugin.onContextLauch(data);
            } catch (e) {
                console.log('[rec]', 'watch error', e);
                openCard(m);
            }
        }

        if (data.imdb_id) return launch();

        // Как и Lampa, сначала подтягиваем imdb_id — по нему плагины ищут точнее
        Lampa.Loading.start(function () {
            cancelled = true;
            Lampa.Loading.stop();
            Lampa.Controller.toContent();
        });

        tmdbJson((isTv(m) ? 'tv' : 'movie') + '/' + m.id + '/external_ids', {}, function (j) {
            if (j && j.imdb_id) data.imdb_id = j.imdb_id;
            launch();
        });
    }

    // ---------- Категории ----------

    function today() {
        var d = new Date();
        var mm = d.getMonth() + 1;
        var dd = d.getDate();
        return d.getFullYear() + '-' + (mm < 10 ? '0' : '') + mm + '-' + (dd < 10 ? '0' : '') + dd;
    }

    // Аниме: японская/китайская/корейская анимация — убираем из всех подборок
    function isAnime(m) {
        var anim = (m.genre_ids || []).indexOf(16) >= 0;
        var lang = m.original_language;
        var asia = lang === 'ja' || lang === 'zh' || lang === 'ko' || lang === 'cn';
        var jp = (m.origin_country || []).indexOf('JP') >= 0;
        return anim && (asia || jp);
    }

    function clean(items) {
        return items.filter(function (m) {
            if (!m || !m.poster_path || isAnime(m)) return false;
            if (m.media_type && m.media_type !== 'movie' && m.media_type !== 'tv') return false;
            return true;
        });
    }

    function copy(o) {
        var r = {};
        for (var k in o) r[k] = o[k];
        return r;
    }

    // Источник ряда: если после фильтров мало фильмов — догружаем вторую страницу
    function source(path, params, filter) {
        params = params || {};
        return function (cb) {
            tmdb(path, params, function (a) {
                a = clean(a);
                if (filter) a = a.filter(filter);
                if (a.length >= 12) return cb(a);

                var p2 = copy(params);
                p2.page = 2;
                tmdb(path, p2, function (b) {
                    b = clean(b);
                    if (filter) b = b.filter(filter);
                    cb(a.concat(b));
                });
            });
        };
    }

    function discover(params) {
        return source('discover/movie', params);
    }

    // Подборка по времени года: основной запрос + запасной, если основной пустой
    function seasonCategory() {
        var month = new Date().getMonth();
        var s;

        if (month === 11 || month === 0) s = {
            title: 'Новогоднее настроение',
            main: { with_keywords: '207317|252123', sort_by: 'popularity.desc', 'vote_count.gte': 100 },
            spare: { with_genres: '10751,35', sort_by: 'popularity.desc', 'vote_count.gte': 500 }
        };
        else if (month === 1) s = {
            title: 'Ко Дню всех влюблённых',
            main: { with_genres: 10749, sort_by: 'popularity.desc', 'vote_count.gte': 500 },
            spare: { with_genres: 10749, sort_by: 'vote_average.desc', 'vote_count.gte': 300 }
        };
        else if (month >= 2 && month <= 4) s = {
            title: 'Весеннее настроение: лёгкое и романтичное',
            main: { with_genres: '35,10749', sort_by: 'popularity.desc', 'vote_count.gte': 300 },
            spare: { with_genres: 35, sort_by: 'popularity.desc', 'vote_count.gte': 300 }
        };
        else if (month >= 5 && month <= 7) s = {
            title: 'Летние приключения',
            main: { with_genres: 12, with_keywords: 13088, sort_by: 'popularity.desc', 'vote_count.gte': 100 },
            spare: { with_genres: 12, sort_by: 'popularity.desc', 'vote_count.gte': 500 }
        };
        else if (month === 8) s = {
            title: 'Снова в школу',
            main: { with_keywords: 6270, sort_by: 'popularity.desc', 'vote_count.gte': 200 },
            spare: { with_genres: '35,10751', sort_by: 'popularity.desc', 'vote_count.gte': 500 }
        };
        else if (month === 9) s = {
            title: 'Хэллоуин: мурашки по коже',
            main: { with_keywords: 3335, sort_by: 'popularity.desc', 'vote_count.gte': 100 },
            spare: { with_genres: 27, sort_by: 'popularity.desc', 'vote_count.gte': 500 }
        };
        else s = {
            title: 'Уютная осень',
            main: { with_keywords: 178883, sort_by: 'popularity.desc', 'vote_count.gte': 50 },
            spare: { with_genres: '18,10749', sort_by: 'popularity.desc', 'vote_count.gte': 500 }
        };

        return {
            title: s.title,
            load: function (cb) {
                tmdb('discover/movie', s.main, function (items) {
                    if (items.length >= 6) cb(items);
                    else tmdb('discover/movie', s.spare, cb);
                });
            }
        };
    }

    function buildCategories() {
        var cats = [];
        var hist = history();
        var seen = {};
        var year = new Date().getFullYear();

        hist.forEach(function (c) { seen[c.id] = true; });

        // «Потому что вы смотрели …» по трём последним тайтлам
        hist.slice(0, 3).forEach(function (card) {
            var method = isTv(card) ? 'tv' : 'movie';
            cats.push({
                title: 'Потому что вы смотрели «' + (card.title || card.name) + '»',
                load: source(method + '/' + card.id + '/recommendations', {}, function (m) { return !seen[m.id]; })
            });
        });

        // Тренды отдельно для кино и сериалов
        cats.push({ title: 'Тренды недели: кино', load: source('trending/movie/week') });
        cats.push({ title: 'Тренды недели: сериалы', load: source('trending/tv/week') });

        // Новинки
        cats.push({ title: 'Сейчас в кино', load: source('movie/now_playing') });
        // movie/upcoming отдаёт и уже вышедшие фильмы, поэтому берём discover с датой от сегодня
        cats.push({
            title: 'Скоро в кино',
            load: discover({ 'primary_release_date.gte': today(), sort_by: 'popularity.desc' })
        });

        cats.push(seasonCategory());

        cats.push({
            title: 'Лучшее за ' + year + ' год',
            load: function (cb) {
                tmdb('discover/movie', { primary_release_year: year, sort_by: 'vote_average.desc', 'vote_count.gte': 200 }, function (items) {
                    if (items.length >= 6) cb(items);
                    else tmdb('discover/movie', { primary_release_year: year - 1, sort_by: 'vote_average.desc', 'vote_count.gte': 500 }, cb);
                });
            }
        });

        // Сериалы (тренды сериалов — выше, отдельным рядом)
        cats.push({ title: 'Сериалы: сейчас в эфире', load: source('tv/on_the_air') });
        cats.push({ title: 'Сериалы: лучшие по рейтингу', load: source('tv/top_rated') });

        // Жанры
        [
            ['Боевики', 28], ['Фантастика', 878], ['Комедии', 35], ['Триллеры', 53],
            ['Ужасы', 27], ['Драмы', 18], ['Детективы', 9648]
        ].forEach(function (g) {
            cats.push({
                title: g[0],
                load: discover({ with_genres: g[1], sort_by: 'popularity.desc', 'vote_count.gte': 300 })
            });
        });

        cats.push({ title: 'Лучшие фильмы всех времён', load: source('movie/top_rated') });

        cats.forEach(function (c) {
            c.items = null;
            c.idx = 0;
            c.loading = false;
            c.waiters = [];
        });

        return cats;
    }

    function loadCat(cat, cb) {
        if (!cat) return;
        if (cat.items) return cb && cb();
        if (cb) cat.waiters.push(cb);
        if (cat.loading) return;

        cat.loading = true;
        cat.load(function (items) {
            var ids = {};
            cat.items = clean(items).filter(function (m) {
                if (ids[m.id]) return false;
                ids[m.id] = true;
                return true;
            }).slice(0, 20);
            cat.loading = false;

            var w = cat.waiters;
            cat.waiters = [];
            w.forEach(function (f) { f(); });
        });
    }

    // ---------- Экран ----------

    function Component() {
        var _this = this;
        var destroyed = false;
        var cats = buildCategories();
        var cur = 0;

        var root = $(
            '<div class="rec-tv layer--wheight">' +
                '<div class="rec-tv__bg"><div class="rec-tv__bg-img"></div><div class="rec-tv__bg-img"></div></div>' +
                '<div class="rec-tv__shade"></div>' +
                '<div class="rec-tv__hero rec-hidden">' +
                    '<div class="rec-tv__genres"></div>' +
                    '<div class="rec-tv__title"></div>' +
                    '<div class="rec-tv__meta"></div>' +
                    '<div class="rec-tv__overview"></div>' +
                    '<div class="rec-tv__hint">Нажмите на постер, чтобы смотреть</div>' +
                '</div>' +
                '<div class="rec-tv__rows">' +
                    '<div class="rec-tv__prev selector"></div>' +
                    '<div class="rec-tv__cat"><span class="rec-tv__cat-name"></span><span class="rec-tv__count"></span></div>' +
                    '<div class="rec-tv__line"><div class="rec-tv__track"></div></div>' +
                    '<div class="rec-tv__next selector"></div>' +
                '</div>' +
            '</div>'
        );

        var bgLayers = root.find('.rec-tv__bg-img');
        var bgActive = 0;
        var bgPath = '';
        var bgTimer;

        var heroEl = root.find('.rec-tv__hero');
        var rowsEl = root.find('.rec-tv__rows');
        var track = root.find('.rec-tv__track');
        var prevEl = root.find('.rec-tv__prev');
        var nextEl = root.find('.rec-tv__next');

        function isActive() {
            var a = Lampa.Activity.active();
            return a && a.activity === _this.activity && Lampa.Controller.enabled().name === 'content';
        }

        function current() {
            var c = cats[cur];
            return c && c.items ? c.items[c.idx] : null;
        }

        // Фон меняем с задержкой, чтобы при быстром листании не грузить каждую картинку
        function setBackdrop(path) {
            if (!path || path === bgPath) return;
            bgPath = path;
            clearTimeout(bgTimer);

            bgTimer = setTimeout(function () {
                loadImage(path, 'w1280', function (url) {
                    if (destroyed || path !== bgPath) return;
                    var next = bgLayers.eq(1 - bgActive);
                    next.css('background-image', 'url("' + url + '")').addClass('show');
                    bgLayers.eq(bgActive).removeClass('show');
                    bgActive = 1 - bgActive;
                });
            }, 300);
        }

        function updateHero(m) {
            if (!m) return;
            heroEl.removeClass('rec-hidden');

            var genres = root.find('.rec-tv__genres').empty();
            (m.genre_ids || []).slice(0, 3).forEach(function (id) {
                if (GENRES[id]) genres.append($('<span class="rec-tv__chip"></span>').text(GENRES[id]));
            });

            root.find('.rec-tv__title').text(m.title || m.name || '');

            var meta = root.find('.rec-tv__meta').empty();
            if (m.vote_average) {
                meta.append($('<span class="rec-tv__rate"></span>').text('★ ' + m.vote_average.toFixed(1)));
            }
            if (yearOf(m)) meta.append($('<span></span>').text(yearOf(m)));
            meta.append($('<span></span>').text(isTv(m) ? 'Сериал' : 'Фильм'));

            root.find('.rec-tv__overview').text(m.overview || 'Описание пока не добавлено.');

            setBackdrop(m.backdrop_path || m.poster_path);
        }

        function updateLabels() {
            var c = cats[cur];
            root.find('.rec-tv__cat-name').text(c ? c.title : '');
            root.find('.rec-tv__count').text(cats.length ? (cur + 1) + ' / ' + cats.length : '');
            prevEl.text(cur > 0 ? '▲  ' + cats[cur - 1].title : '').toggleClass('rec-hidden', cur <= 0);
            nextEl.text(cur < cats.length - 1 ? '▼  ' + cats[cur + 1].title : '').toggleClass('rec-hidden', cur >= cats.length - 1);
        }

        function focusIdx(i) {
            var c = cats[cur];
            if (!c || !c.items || !c.items.length) return;

            i = Math.max(0, Math.min(c.items.length - 1, i));
            c.idx = i;

            var cards = track.children('.rec-card');
            var el = cards.eq(i);
            if (!el.length) return;

            cards.removeClass('focus');
            el.addClass('focus');

            // Активная карточка всегда в левой позиции, как в Apple TV
            var off = el[0].offsetLeft - cards[0].offsetLeft;
            track.css('transform', 'translate3d(' + (-off) + 'px,0,0)');

            updateHero(c.items[i]);
        }

        function makeCard(m, i) {
            var card = $('<div class="rec-card selector"><div class="rec-card__img"><img /></div></div>');
            setPoster(card.find('img')[0], m.poster_path);

            // Мышь и тач: наведение выбирает, клик — смотреть, долгий тап — карточка
            card.on('hover:focus hover:hover', function () {
                if (cats[cur] && cats[cur].idx !== i) focusIdx(i);
            });
            card.on('hover:enter', function () {
                focusIdx(i);
                watch(m);
            });
            card.on('hover:long', function () {
                openCard(m);
            });

            return card;
        }

        function animateRows(dir) {
            rowsEl.removeClass('rec-tv__rows--down rec-tv__rows--up');
            if (!dir) return;
            void rowsEl[0].offsetWidth; // перезапуск анимации
            rowsEl.addClass(dir > 0 ? 'rec-tv__rows--down' : 'rec-tv__rows--up');
        }

        function showEmpty() {
            heroEl.addClass('rec-hidden');
            rowsEl.addClass('rec-hidden');
            if (!root.find('.rec-tv__empty').length) {
                root.append('<div class="rec-tv__empty">Не удалось загрузить подборки.<br>Проверьте интернет или прокси TMDB в настройках Lampa.</div>');
            }
            if (_this.activity) _this.activity.loader(false);
        }

        function removeCat(c) {
            var i = cats.indexOf(c);
            if (i < 0) return;

            cats.splice(i, 1);

            if (!cats.length) return showEmpty();

            if (i === cur) {
                if (cur >= cats.length) cur = cats.length - 1;
                renderCat(0);
            } else {
                if (i < cur) cur--;
                updateLabels();
            }
        }

        function prefetch() {
            [cats[cur + 1], cats[cur - 1]].forEach(function (c) {
                if (!c || c.items || c.loading) return;
                loadCat(c, function () {
                    if (!destroyed && !c.items.length) removeCat(c);
                });
            });
        }

        function renderCat(dir) {
            var c = cats[cur];
            if (!c) return showEmpty();

            updateLabels();
            animateRows(dir);
            track.empty().css('transform', 'translate3d(0,0,0)');

            if (!c.items) {
                for (var s = 0; s < 7; s++) track.append('<div class="rec-card rec-card--skeleton"><div class="rec-card__img"></div></div>');

                loadCat(c, function () {
                    if (destroyed || cats[cur] !== c) return;
                    if (!c.items.length) return removeCat(c);
                    renderCat(0);
                });
                return;
            }

            c.items.forEach(function (m, i) { track.append(makeCard(m, i)); });
            focusIdx(c.idx);

            if (_this.activity) _this.activity.loader(false);
            if (isActive()) Lampa.Controller.collectionSet(root);

            prefetch();
        }

        function switchCat(d) {
            var n = cur + d;
            if (n < 0 || n >= cats.length) return;
            cur = n;
            renderCat(d);
        }

        prevEl.on('hover:enter', function () { switchCat(-1); });
        nextEl.on('hover:enter', function () { switchCat(1); });

        this.create = function () {
            if (this.activity) this.activity.loader(true);
            renderCat(0);
            return this.render();
        };

        this.start = function () {
            if (Lampa.Activity.active() && Lampa.Activity.active().activity !== this.activity) return;

            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(root);
                    // Lampa снимает класс focus при уходе с экрана — восстанавливаем по сохранённому индексу
                    var c = cats[cur];
                    var el = c && c.items ? track.children('.rec-card').eq(c.idx)[0] : null;
                    if (el) {
                        Lampa.Controller.collectionFocus(el, root);
                        focusIdx(c.idx);
                    }
                },
                left: function () {
                    var c = cats[cur];
                    if (c && c.items && c.idx > 0) focusIdx(c.idx - 1);
                    else Lampa.Controller.toggle('menu');
                },
                right: function () {
                    var c = cats[cur];
                    if (c && c.items && c.idx < c.items.length - 1) focusIdx(c.idx + 1);
                },
                up: function () {
                    if (cur > 0) switchCat(-1);
                    else Lampa.Controller.toggle('head');
                },
                down: function () {
                    switchCat(1);
                },
                enter: function () {
                    var m = current();
                    if (m) watch(m);
                },
                long: function () {
                    var m = current();
                    if (m) openCard(m);
                },
                back: function () {
                    Lampa.Activity.backward();
                }
            });

            Lampa.Controller.toggle('content');
        };

        this.render = function () {
            return root;
        };

        this.pause = function () {};
        this.stop = function () {};

        this.destroy = function () {
            destroyed = true;
            clearTimeout(bgTimer);
            root.remove();
        };
    }

    // ---------- Подключение ----------

    function addStyles() {
        var bg = '11,13,18';
        var css =
            '.rec-tv{position:relative;overflow:hidden;background:rgb(' + bg + ')}' +
            '.rec-hidden{display:none !important}' +
            '.rec-tv__bg,.rec-tv__bg-img,.rec-tv__shade{position:absolute;top:0;left:0;right:0;bottom:0}' +
            '.rec-tv__bg-img{background-size:cover;background-position:center 20%;opacity:0;transition:opacity .7s ease}' +
            '.rec-tv__bg-img.show{opacity:1}' +
            '.rec-tv__shade{background:' +
                'linear-gradient(90deg,rgba(' + bg + ',.96) 0%,rgba(' + bg + ',.78) 32%,rgba(' + bg + ',.15) 65%,rgba(' + bg + ',0) 100%),' +
                'linear-gradient(0deg,rgba(' + bg + ',1) 0%,rgba(' + bg + ',.92) 30%,rgba(' + bg + ',0) 60%)}' +
            '.rec-tv__hero{position:absolute;left:3em;top:1.6em;width:46%}' +
            '.rec-tv__genres{display:flex;flex-wrap:wrap;margin-bottom:.7em}' +
            '.rec-tv__chip{padding:.3em .85em;border-radius:1em;background:rgba(255,255,255,.15);font-size:.8em;margin:0 .5em .4em 0}' +
            '.rec-tv__title{font-size:2.8em;font-weight:700;line-height:1.1;margin-bottom:.35em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
            '.rec-tv__meta{display:flex;align-items:center;margin-bottom:.8em}' +
            '.rec-tv__meta span{margin-right:1.1em;opacity:.9}' +
            '.rec-tv__rate{color:#ffd54a;font-weight:700;opacity:1 !important}' +
            '.rec-tv__overview{line-height:1.45;opacity:.85;max-width:36em;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}' +
            '.rec-tv__hint{margin-top:1.1em;font-size:.8em;opacity:.5}' +
            '.rec-tv__rows{position:absolute;left:0;right:0;bottom:.6em}' +
            '.rec-tv__rows--down{animation:recInDown .3s ease}' +
            '.rec-tv__rows--up{animation:recInUp .3s ease}' +
            '@keyframes recInDown{from{opacity:0;transform:translateY(1.5em)}to{opacity:1;transform:none}}' +
            '@keyframes recInUp{from{opacity:0;transform:translateY(-1.5em)}to{opacity:1;transform:none}}' +
            '.rec-tv__prev,.rec-tv__next{margin-left:3.4em;font-size:.85em;opacity:.45;padding:.25em 0;display:inline-block}' +
            '.rec-tv__prev{margin-bottom:.4em}' +
            '.rec-tv__prev.focus,.rec-tv__next.focus{opacity:.9}' +
            // 2.22em × 1.35 = 3em — заголовок ровно над левым краем карточек
            '.rec-tv__cat{margin:.2em 0 0 2.22em;font-size:1.35em;font-weight:600;display:flex;align-items:baseline}' +
            '.rec-tv__count{font-size:.6em;opacity:.45;margin-left:.9em;font-weight:400}' +
            // Отступы под увеличенную карточку: сверху от заголовка и снизу до подписи следующей категории
            '.rec-tv__line{overflow:hidden;padding:2em 0 1.8em 3em}' +
            '.rec-tv__track{display:flex;transition:transform .3s ease;will-change:transform}' +
            '.rec-card{position:relative;flex:0 0 auto;width:8.4em;margin-right:1.1em;transition:transform .2s ease,margin .2s ease;transform-origin:left center}' +
            '.rec-card__img{padding-top:150%;position:relative;border-radius:.6em;overflow:hidden;background:rgba(255,255,255,.08)}' +
            '.rec-card__img img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .3s}' +
            '.rec-card__img img.loaded{opacity:1}' +
            // Выбранная карточка крупнее; доп. отступ справа, чтобы не наезжала на соседнюю
            '.rec-card.focus{transform:scale(1.22);margin-right:3em}' +
            '.rec-card.focus .rec-card__img{box-shadow:0 0 0 .18em #fff,0 .6em 1.5em rgba(0,0,0,.6)}' +
            '.rec-card--skeleton .rec-card__img{animation:recPulse 1.2s ease-in-out infinite}' +
            '@keyframes recPulse{50%{opacity:.45}}' +
            '.rec-tv__empty{position:absolute;top:40%;left:0;right:0;text-align:center;opacity:.7;line-height:1.6}';

        $('body').append('<style id="rec-plugin-style">' + css + '</style>');
    }

    function addSettings() {
        Lampa.SettingsApi.addComponent({
            component: 'rec_settings',
            name: 'Подборки',
            icon: ICON
        });

        // Выбор плагина для «Смотреть» из установленных онлайн-плагинов
        var values = { auto: 'Автоматически (Showy RU, если есть)' };
        videoPlugins().forEach(function (p) {
            if (p.component) values[p.component] = p.name || p.component;
        });

        Lampa.SettingsApi.addParam({
            component: 'rec_settings',
            param: { name: 'rec_watch_plugin', type: 'select', values: values, default: 'auto' },
            field: { name: 'Плагин для «Смотреть»', description: 'Что запускается по OK на карточке' }
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
            Lampa.Listener.follow('full', onFullReady);
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
