(function () {
    'use strict';

    // Версия для проверки, что плагин загрузился
    var PLUGIN_NAME = 'rec_home';
    var IMG = 'https://image.tmdb.org/t/p/w342';
    var API = 'https://api.themoviedb.org/3';

    function getKey() {
        return Lampa.Storage.get('rec_tmdb_key', '');
    }

    function tmdb(path, params, cb) {
        var key = getKey();
        if (!key) {
            Lampa.Noty.show('Укажите TMDB ключ в настройках плагина «Подборки»');
            return cb([]);
        }
        var q = Object.keys(params || {}).map(function (k) {
            return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
        }).join('&');
        var url = API + path + '?api_key=' + encodeURIComponent(key) + '&language=ru-RU' + (q ? '&' + q : '');

        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (j) { cb(j.results || []); })
            .catch(function () { cb([]); });
    }

    // Последний просмотренный фильм из истории Lampa (API проверить на своей версии)
    function lastWatched(cb) {
        try {
            var hist = Lampa.Favorite.get({ type: 'history' }) || [];
            var movie = hist.find ? hist.find(function (m) { return m.id; }) : hist[0];
            cb(movie && movie.id ? movie : null);
        } catch (e) {
            cb(null);
        }
    }

    // Ряды подборок: [заголовок, функция-загрузчик]
    var ROWS = [
        {
            title: 'Похожие на последний просмотренный',
            load: function (cb) {
                lastWatched(function (movie) {
                    if (!movie) return cb([]);
                    tmdb('/movie/' + movie.id + '/recommendations', {}, cb);
                });
            }
        },
        {
            title: 'Тренды недели',
            load: function (cb) {
                tmdb('/trending/movie/week', {}, cb);
            }
        },
        {
            title: 'Лучшее по рейтингу',
            load: function (cb) {
                tmdb('/discover/movie', {
                    sort_by: 'vote_average.desc',
                    'vote_count.gte': 1000
                }, cb);
            }
        },
        {
            title: 'Вечер в одиночку: комедии',
            load: function (cb) {
                tmdb('/discover/movie', {
                    with_genres: 35,
                    sort_by: 'popularity.desc'
                }, cb);
            }
        }
    ];

    function Component(object) {
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var html = $('<div class="rec-home"></div>');

        this.create = function () {
            scroll.minus();
            html.append(scroll.render());
            ROWS.forEach(function (row) {
                var line = $('<div class="rec-row"><div class="rec-row__title">' + row.title + '</div><div class="rec-row__items"></div></div>');
                scroll.append(line);
                row.load(function (items) {
                    var box = line.find('.rec-row__items');
                    items.slice(0, 20).forEach(function (m) {
                        if (!m.poster_path) return;
                        var card = $('<div class="rec-card selector"><img src="' + IMG + m.poster_path + '" /><div>' + (m.title || m.name || '') + '</div></div>');
                        card.on('hover:enter', function () {
                            // Открываем карточку фильма стандартным экраном Lampa (проверить на версии)
                            Lampa.Activity.push({
                                url: '',
                                title: m.title,
                                component: 'full',
                                id: m.id,
                                method: 'movie',
                                card: m
                            });
                        });
                        box.append(card);
                    });
                    Lampa.Controller.update();
                });
            });
        };

        this.render = function () {
            return html;
        };

        this.start = function () {
            Lampa.Controller.add(PLUGIN_NAME, {
                toggle: function () {
                    Lampa.Controller.collectionSet(html);
                    Lampa.Controller.collectionFocus(html.find('.selector')[0], html);
                },
                back: function () {
                    Lampa.Activity.backward();
                }
            });
            Lampa.Controller.toggle(PLUGIN_NAME);
        };

        this.pause = function () {};
        this.stop = function () {};
        this.destroy = function () {
            scroll.destroy();
            html.remove();
        };
    }

    function init() {
        // Стили для рядов
        Lampa.Template.add('rec_style',
            '<style>' +
            '.rec-home{padding:20px}' +
            '.rec-row{margin-bottom:30px}' +
            '.rec-row__title{font-size:1.4em;margin-bottom:10px}' +
            '.rec-row__items{display:flex;overflow-x:auto;gap:12px}' +
            '.rec-card{width:150px;flex:0 0 auto}' +
            '.rec-card img{width:100%;border-radius:8px}' +
            '.rec-card.focus{outline:3px solid #fff}' +
            '</style>');
        $('body').append(Lampa.Template.get('rec_style', {}, true));

        // Экран
        Lampa.Component.add(PLUGIN_NAME, Component);

        // Пункт меню (метод Menu API проверьте на вашей версии Lampa)
        Lampa.Menu.addButton('<svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M4 4h16v4H4zm0 6h10v4H4zm0 6h16v4H4z"/></svg>', 'Подборки', function () {
            Lampa.Activity.push({ url: '', title: 'Подборки', component: PLUGIN_NAME });
        });

        // Настройка ключа TMDB
        Lampa.SettingsApi.addComponent({
            component: 'rec_settings',
            name: 'Подборки',
            icon: ''
        });
        Lampa.SettingsApi.addParam({
            component: 'rec_settings',
            param: { name: 'rec_tmdb_key', type: 'input', default: '' },
            field: { name: 'TMDB API ключ (v3)', description: 'Короткий ключ из themoviedb.org/settings/api' }
        });
    }

    // Ждём готовности Lampa, как и требует plugin API
    if (window.appready) init();
    else Lampa.Listener.follow('app', function (e) {
        if (e.type === 'ready') init();
    });
})();
