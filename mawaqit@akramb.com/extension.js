import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {parseCalendar, schedule, mosqueSlug} from './calendar.js';
import {dueNotifications} from './notifications.js';

export default class MawaqitExtension extends Extension {
    enable() {
        this._alive = true;
        this._generation = (this._generation ?? 0) + 1;
        this._searchGeneration = (this._searchGeneration ?? 0) + 1;
        this._requests = new Set();
        this._lastNotificationCheck = Math.floor(Date.now() / 1000);
        this._notificationSeen = new Set();
        this._session = new Soup.Session({timeout: 20, user_agent: 'AkramB-Mawaqit-GNOME/1.0'});
        this._file = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_config_dir(), 'mrie-mawaqit', 'state.json']));
        try {
            const [ok, bytes] = this._file.load_contents(null);
            if (ok) this._state = JSON.parse(new TextDecoder().decode(bytes));
        } catch (_) { /* First launch has no saved mosque. */ }
        this._state ??= {};
        this._data = this._state.calendar;
        this._button = new PanelMenu.Button(0.0, 'Mawaqit Prayer Times');
        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        box.add_child(new St.Icon({icon_name: 'weather-clear-night-symbolic', style_class: 'system-status-icon'}));
        this._panelLabel = new St.Label({text: '', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._panelLabel);
        this._button.add_child(box);
        this._button.menu.box.add_style_class_name('mawaqit-menu');
        this._searchEntry = this._entry('Mosque, city, coordinates or URL', () => this._search());
        this._searchEntry.set_primary_icon(new St.Icon({icon_name: 'system-search-symbolic'}));
        this._status = this._text('Enter a mosque or city and press Enter');
        this._status.label.connect('notify::text', () => {
            this._status.actor.visible = Boolean(this._status.label.text);
        });
        this._status.label.clutter_text.line_wrap = true;
        this._status.label.clutter_text.ellipsize = 0;
        this._status.add_style_class_name('mawaqit-status');
        this._results = new PopupMenu.PopupMenuSection();
        this._button.menu.addMenuItem(this._results);
        this._prayerSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this._button.menu.addMenuItem(this._prayerSeparator);
        this._title = this._text('');
        this._subtitle = this._text('');
        this._title.add_style_class_name('mawaqit-mosque');
        this._title.insert_child_at_index(this._icon('mark-location-symbolic'), 1);
        this._title.label.clutter_text.line_wrap = true;
        this._subtitle.add_style_class_name('mawaqit-subtitle');
        this._upcomingSummary = this._text('');
        this._upcomingSummary.add_style_class_name('mawaqit-upcoming-summary');
        this._todayHeading = this._text('TODAY’S PRAYERS');
        this._todayHeading.add_style_class_name('mawaqit-section-heading');
        this._rows = new PopupMenu.PopupMenuSection();
        this._button.menu.addMenuItem(this._rows);
        this._nightHeading = this._text('NIGHT & SUNRISE');
        this._nightHeading.add_style_class_name('mawaqit-section-heading');
        this._nightRows = new PopupMenu.PopupMenuSection();
        this._button.menu.addMenuItem(this._nightRows);
        this._notificationSwitch = new PopupMenu.PopupSwitchMenuItem('Notifications', this._state.notificationsEnabled !== false);
        this._notificationSwitch.connect('toggled', (_item, enabled) => {
            this._state.notificationsEnabled = enabled;
            this._lastNotificationCheck = Math.floor(Date.now() / 1000);
            this._save();
            if (enabled) Main.notify('Prayer notifications enabled', 'Alerts at prayer start and the last third of the night.');
        });
        this._button.menu.addMenuItem(this._notificationSwitch);
        this._refreshAction = this._action('Refresh prayer times', () => this._refresh());
        this._refreshAction.insert_child_at_index(this._icon('view-refresh-symbolic'), 1);
        this._refreshAction.add_style_class_name('mawaqit-refresh');
        this._button.menu.connect('open-state-changed', (_menu, open) => {
            if (open) this._render();
            if (open && !this._state.slug) this._searchEntry.grab_key_focus();
        });
        Main.panel.addToStatusArea(this.uuid, this._button);
        this._render();
        if (this._state.slug) this._refresh();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
            this._render();
            this._checkNotifications();
            if (this._state.slug && Date.now() - (this._lastAttempt ?? 0) > 3600000)
                this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _checkNotifications() {
        const since = this._lastNotificationCheck;
        this._lastNotificationCheck = Math.floor(Date.now() / 1000);
        if (!this._alive || !this._data || !this._state.slug || this._state.notificationsEnabled === false || this._state.year !== new Date().getUTCFullYear()) return;
        try {
            const view = schedule(this._data);
            for (const event of dueNotifications(view, since, this._notificationSeen)) {
                Main.notify(event.title, `${this._state.name ?? this._state.slug} · ${event.body} (${view.timezone})`);
                this._notificationSeen.add(event.id);
            }
            if (this._notificationSeen.size > 30)
                this._notificationSeen = new Set([...this._notificationSeen].slice(-30));
        } catch (error) { console.warn(`Prayer notification: ${error.message}`); }
    }

    _remaining(unix, now) {
        const minutes = Math.max(1, Math.ceil((unix - now) / 60));
        return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
    }

    _icon(name) {
        return new St.Icon({icon_name: name, style_class: 'mawaqit-icon', y_align: Clutter.ActorAlign.CENTER});
    }

    _text(text) {
        const item = new PopupMenu.PopupMenuItem(text, {reactive: false});
        item.add_style_class_name('mawaqit-info');
        this._button.menu.addMenuItem(item);
        return item;
    }

    _action(text, callback) {
        const item = new PopupMenu.PopupMenuItem(text);
        item.connect('activate', callback);
        this._button.menu.addMenuItem(item);
        return item;
    }

    _entry(hint, callback) {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const entry = new St.Entry({hint_text: hint, can_focus: true, x_expand: true, style_class: 'mawaqit-entry'});
        entry.clutter_text.connect('activate', callback);
        item.add_child(entry);
        this._button.menu.addMenuItem(item);
        return entry;
    }

    async _get(url) {
        const cancel = new Gio.Cancellable();
        this._requests.add(cancel);
        const message = Soup.Message.new('GET', url);
        try {
            const bytes = await new Promise((resolve, reject) => {
                this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancel, (session, result) => {
                    try { resolve(session.send_and_read_finish(result)); } catch (error) { reject(error); }
                });
            });
            if (!this._alive) throw new Error('Extension disabled');
            if (message.status_code !== 200) throw new Error(`Service returned ${message.status_code}. Try again later.`);
            return new TextDecoder().decode(bytes.get_data());
        } finally { this._requests.delete(cancel); }
    }

    _error(error) {
        if (this._alive) this._status.label.text = error.message;
    }

    async _search() {
        const generation = ++this._searchGeneration;
        this._results.removeAll();
        try {
            const query = this._searchEntry.get_text().trim();
            if (/^https?:\/\//i.test(query)) {
                const slug = mosqueSlug(query);
                this._choose(slug, slug);
                return;
            }
            let params;
            if (query.includes(',')) {
                const parts = query.split(',').map(s => s.trim());
                const [lat, lon] = parts.map(Number);
                if (parts.length !== 2 || parts.some(s => !s) || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
                    throw new Error('Enter valid latitude, longitude coordinates.');
                params = `lat=${lat}&lon=${lon}`;
            } else {
                if (query.length < 2) throw new Error('Enter at least two letters, a mosque URL or coordinates.');
                params = `word=${encodeURIComponent(query)}`;
                // A slug can also be a city name. Offer direct selection alongside search.
                if (/^[a-zA-Z0-9_-]+$/.test(query)) {
                    const direct = new PopupMenu.PopupMenuItem(`Open mosque: ${query}`);
                    direct.connect('activate', () => this._choose(query, query));
                    this._results.addMenuItem(direct);
                }
            }
            this._status.label.text = 'Searching…';
            const results = JSON.parse(await this._get(`https://mawaqit.net/api/2.0/mosque/search?${params}`));
            if (!this._alive || generation !== this._searchGeneration) return;
            if (!Array.isArray(results)) throw new Error('The search service returned an unexpected response.');
            const mosques = results.filter(m => m.slug && m.name && !m.closed);
            this._status.label.text = mosques.length ? `${mosques.length} mosques found; showing up to 10.` : 'No mosques found. Try another city or paste a mosque URL.';
            for (const mosque of mosques.slice(0, 10)) {
                const item = new PopupMenu.PopupBaseMenuItem();
                item.add_style_class_name('mawaqit-result');
                item.add_child(this._icon('mark-location-symbolic'));
                const details = new St.BoxLayout({vertical: true, x_expand: true});
                const name = new St.Label({text: mosque.name, style_class: 'mawaqit-result-name'});
                name.clutter_text.line_wrap = true;
                details.add_child(name);
                if (mosque.localisation) {
                    const location = new St.Label({text: mosque.localisation, style_class: 'mawaqit-result-location'});
                    location.clutter_text.line_wrap = true;
                    details.add_child(location);
                }
                item.add_child(details);
                item.add_child(this._icon('go-next-symbolic'));
                item.connect('activate', () => this._choose(mosque.slug, mosque.name));
                this._results.addMenuItem(item);
            }
        } catch (error) { if (generation === this._searchGeneration) this._error(error); }
    }

    _choose(slug, name) {
        this._searchGeneration++;
        // Keep the current mosque and calendar until the replacement loads successfully.
        this._refresh({slug: mosqueSlug(slug), name});
    }

    async _refresh(candidate = this._state) {
        if (!candidate.slug || !this._alive) return;
        const generation = ++this._generation;
        this._lastAttempt = Date.now();
        this._status.label.text = 'Loading prayer times…';
        try {
            const data = parseCalendar(await this._get(`https://mawaqit.net/en/m/${encodeURIComponent(candidate.slug)}`));
            schedule(data);
            if (!this._alive || generation !== this._generation) return;
            if (candidate.slug !== this._state.slug) {
                this._lastNotificationCheck = Math.floor(Date.now() / 1000);
                this._notificationSeen.clear();
            }
            this._data = data;
            this._state = {notificationsEnabled: this._state.notificationsEnabled !== false, slug: candidate.slug, name: candidate.name, calendar: data, fetched: Date.now(), year: new Date().getUTCFullYear()};
            this._status.label.text = '';
            this._results.removeAll();
            this._searchEntry.set_text('');
            this._save();
            this._render();
        } catch (error) {
            if (generation === this._generation) this._error(error);
        }
    }

    _save() {
        try {
            GLib.mkdir_with_parents(this._file.get_parent().get_path(), 0o700);
            this._file.replace_contents(JSON.stringify(this._state), null, false, Gio.FileCreateFlags.PRIVATE, null);
        } catch (error) { this._error(new Error(`Could not save your mosque: ${error.message}`)); }
    }

    _render() {
        const active = Boolean(this._state.slug);
        for (const item of [this._prayerSeparator, this._title, this._subtitle, this._upcomingSummary, this._todayHeading, this._rows, this._nightHeading, this._nightRows, this._notificationSwitch, this._refreshAction])
            item.actor.visible = active;
        this._status.actor.visible = Boolean(this._status.label.text);
        this._upcomingSummary.actor.visible = false;
        this._panelLabel.text = '';
        this._panelLabel.visible = false;
        if (!this._data) return;
        try {
            if (this._state.year !== new Date().getUTCFullYear()) throw new Error('Refresh required for the new year.');
            const view = schedule(this._data);
            this._rows.removeAll();
            this._title.label.text = this._state.name ?? this._state.slug;
            const cached = Date.now() - this._state.fetched > 3600000 ? ' · cached' : '';
            this._subtitle.label.text = `${view.date} · ${view.timezone}${cached}`;
            const {current, night, now} = view;
            const nextDescription = view.next ? `Next: ${view.next.name} at ${view.next.time}${view.today.includes(view.next) ? '' : ' tomorrow'}` : '';
            let panelStatus;
            if (current) panelStatus = `${current.name} · ${this._remaining(current.end, now)} left`;
            else if (night.lastThirdActive) panelStatus = `Last third · ${this._remaining(night.end, now)}`;
            else if (night.active && now >= night.midnight) panelStatus = `Last third in ${this._remaining(night.lastThird, now)}`;
            else if (view.next) panelStatus = `${view.next.name} in ${this._remaining(view.next.unix, now)}`;
            this._upcomingSummary.label.text = nextDescription;
            this._upcomingSummary.actor.visible = Boolean(!current && nextDescription);
            this._panelLabel.text = panelStatus ?? '';
            this._panelLabel.visible = Boolean(panelStatus);
            const icons = ['weather-clear-night-symbolic', 'weather-clear-symbolic',
                'weather-clear-symbolic', 'weather-few-clouds-symbolic',
                'weather-few-clouds-night-symbolic', 'weather-clear-night-symbolic'];
            const prayers = current && !view.today.includes(current) ? [current, ...view.today] : view.today;
            for (const prayer of prayers) {
                if (prayer.sunrise) continue;
                const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
                item.add_style_class_name('mawaqit-prayer-row');
                item.add_style_class_name('mawaqit-info');
                const index = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].indexOf(prayer.name);
                item.add_child(this._icon(icons[index]));
                if (prayer === current) {
                    item.add_style_class_name('mawaqit-current');
                    const details = new St.BoxLayout({vertical: true, x_expand: true});
                    const headline = new St.BoxLayout({x_expand: true, style_class: 'mawaqit-current-headline'});
                    headline.add_child(new St.Label({text: prayer.name, x_expand: true}));
                    headline.add_child(new St.Label({text: `${this._remaining(prayer.end, now)} left`}));
                    details.add_child(headline);
                    const end = new St.Label({text: `Ends at ${prayer.endTime}${prayer.name === 'Isha' ? ' · Islamic midnight' : ''}`, style_class: 'mawaqit-current-detail'});
                    end.clutter_text.line_wrap = true;
                    details.add_child(end);
                    if (nextDescription) {
                        const next = new St.Label({text: nextDescription, style_class: 'mawaqit-current-detail'});
                        next.clutter_text.line_wrap = true;
                        details.add_child(next);
                    }
                    item.add_child(details);
                } else {
                    item.add_child(new St.Label({text: prayer.name, x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
                    const status = prayer.end <= now ? `Ended ${prayer.endTime}`
                        : `Ends ${prayer.endTime} · ${this._remaining(prayer.end, now)}`;
                    item.add_child(new St.Label({text: status, style_class: 'mawaqit-prayer-detail', y_align: Clutter.ActorAlign.CENTER}));
                    if (prayer === view.next) item.add_style_class_name('mawaqit-next');
                    else if (prayer.end <= now) item.add_style_class_name('mawaqit-past');
                    item.add_child(new St.Label({text: prayer.time, style_class: 'mawaqit-prayer-time', y_align: Clutter.ActorAlign.CENTER}));
                }
                this._rows.addMenuItem(item);
            }
            this._nightRows.removeAll();
            const {milestones} = view;
            for (const [key, name, time, start] of [
                ['midnight', 'Islamic midnight', milestones.midnightTime, milestones.midnight],
                ['lastThird', 'Last third', milestones.lastThirdTime, milestones.lastThird],
                ['sunrise', 'Sunrise', milestones.sunriseTime, milestones.sunrise],
            ]) {
                const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
                item.add_style_class_name('mawaqit-night-row');
                item.add_child(new St.Label({text: name, x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
                const selected = milestones.phase === key;
                const status = selected ? `In ${this._remaining(start, now)}`
                    : milestones.active && start <= now ? 'Passed' : '';
                item.add_child(new St.Label({text: status, style_class: 'mawaqit-prayer-detail', y_align: Clutter.ActorAlign.CENTER}));
                item.add_child(new St.Label({text: time, style_class: 'mawaqit-prayer-time', y_align: Clutter.ActorAlign.CENTER}));
                if (selected) item.add_style_class_name('mawaqit-night-active');
                else item.add_style_class_name('mawaqit-past');
                this._nightRows.addMenuItem(item);
            }
        } catch (error) {
            this._rows.removeAll();
            this._nightRows.removeAll();
            this._nightHeading.actor.visible = false;
            this._panelLabel.visible = false;
            this._upcomingSummary.actor.visible = false;
            this._error(error);
        }
    }

    disable() {
        this._alive = false;
        this._generation++;
        this._searchGeneration++;
        if (this._timer) GLib.Source.remove(this._timer);
        this._timer = null;
        for (const request of this._requests) request.cancel();
        this._session.abort();
        this._button.destroy();
        this._button = null;
        this._state = null;
        this._data = null;
    }
}
