# Mawaqit GNOME top bar

By [Akram Boussanni](https://akramb.com). Source and releases: [akramboussanni/mawaqit-gnome](https://github.com/akramboussanni/mawaqit-gnome).

A standalone GNOME Shell extension for GNOME 45–50. It fetches Mawaqit directly; no backend is required. Click the moon in the top bar to see today's six times, search for a mosque by name or city, or paste its Mawaqit URL. The top bar shows a moon and compact live status: time left for the current prayer, time until the next prayer, or the last-third countdown. The monochrome menu follows the Shell theme and shows the current prayer’s remaining time, deadline and next prayer inside its expanded row, alongside other prayer end times and night milestones. Titles, mosque name and the active prayer use white text; other prayer rows stay gray. In the night section, only the current milestone is bright: midnight from Isha, last third after midnight, then sunrise once the last third begins. After sunrise all milestones are dim until Isha; sunrise always belongs to that night’s following morning. Sunrise is informational and grouped with Islamic midnight and the last third in a compact, icon-free section. The main list contains only the five prayers. All displayed times use the mosque's timezone.

## Install

Download `mawaqit@akramb.com.shell-extension.zip` from the [latest release](https://github.com/akramboussanni/mawaqit-gnome/releases/latest), then run:

```sh
gnome-extensions install mawaqit@akramb.com.shell-extension.zip
```

Log out and back in, then enable it:

```sh
gnome-extensions enable mawaqit@akramb.com
```

Use `--force` with the install command when updating an existing installation. A fresh login is necessary to reload changed extension code on Wayland.

## Choose a mosque

Use the single search field at the top and press Enter:

- Enter a mosque name or city and select a result.
- Enter `latitude, longitude` to find nearby mosques.
- Paste a Mawaqit mosque URL to load it directly.
- Enter a slug and select **Open mosque** beneath the field.

Prayer times and refresh controls appear after a mosque is selected.
The current mosque stays selected if a replacement fails to load. The selected mosque and calendar are saved privately in `~/.config/mrie-mawaqit/state.json`. The extension refreshes hourly, uses the calendar to roll over daily, and shows a cached label when data is older than an hour. Errors appear in the menu. A cached calendar from an earlier year is withheld until refreshed. Notifications are enabled by default and can be switched off in the menu. Alerts announce each prayer’s start with its deadline, and the start of the last third of the night. GNOME’s Do Not Disturb setting is respected. Historical alerts are not replayed when enabling the extension, changing mosque, or resuming after a long sleep. No background location tracking is enabled.

## Prayer windows and night status

Displayed windows run from Fajr to sunrise, Dhuhr to Asr, Asr to Maghrib, Maghrib to Isha, and Isha to Islamic midnight, using the selected mosque’s published times. The Isha cutoff follows the requested [midnight convention](https://sunnah.com/muslim:612a).

Islamic midnight is halfway between Maghrib and the following Fajr, rather than civil 00:00. The last third starts two thirds through that same interval and ends at Fajr. Calculations use elapsed time, including daylight-saving changes. Before Fajr, night status uses the previous day’s Maghrib. After the Isha deadline, the status switches to the upcoming last third, then shows how long remains while it is active. Countdowns refresh every 30 seconds and when the menu opens.

## Development and validation

```sh
gjs -m mawaqit@akramb.com/tests/calendar.js
gjs -m mawaqit@akramb.com/tests/notifications.js
# Optional: pass a downloaded mosque HTML file to test the real scraper.
gjs -m mawaqit@akramb.com/tests/calendar.js /tmp/mawaqit-mosque.html
gnome-extensions pack --force --extra-source=calendar.js --extra-source=notifications.js --out-dir=gnome-extension mawaqit@akramb.com
```

Use a separate development session to check the Shell UI:

```sh
dbus-run-session gnome-shell --devkit --wayland
```

This requires `/usr/libexec/mutter-devkit` to be installed. Install the rebuilt extension before launching the session so it loads the latest code.

Manual Shell check: enable the extension, search a city, select a mosque, verify times against its Mawaqit page, disable/re-enable, and check that selection is retained. Test an invalid URL and disconnected network to confirm the error and cached data behavior. GNOME 45–49 use the same extension APIs but still need manual compatibility testing; automated checks do not validate the Shell UI.

The scraper uses Mawaqit's embedded `confData` calendar, following the approach in [mrsofiane/mawaqit-api](https://github.com/mrsofiane/mawaqit-api). Search uses the public `/api/2.0/mosque/search` endpoint. These website interfaces can change; service errors are surfaced rather than replaced with invented times.
