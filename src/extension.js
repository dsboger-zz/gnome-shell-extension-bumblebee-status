/*
 * GNOME Shell Extension: Bumblebee Status
 * Copyright (C) 2016  Davi da Silva Böger
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

/*
 * Other credits:
 * - Main idea learned from Bumblebee Indicator extension 
 *      (https://extensions.gnome.org/extension/574/bumblebee-indicator/)
 * - Icon copied from the Optistatus extension 
 *      (https://extensions.gnome.org/extension/710/optistatus/)
 */

const Lang = imports.lang;

const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Shell = imports.gi.Shell;
const GObject = imports.gi.GObject

const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const PanelMenu = imports.ui.panelMenu;

const Config = imports.misc.config;
const Util = imports.misc.util;

const Gettext = imports.gettext;
const _ = Gettext.domain('gnome-shell-extension-bumblebee-status').gettext;

let gicons;

function setIconName(icon, name) {
	icon.set_gicon(gicons[name]);
}

let BumblebeeIndicator = GObject.registerClass(class BumblebeeIndicator extends PanelMenu.SystemIndicator {
	_init() {
		super._init();
		this._parseBumblebeeConfigFile();

		this._statusIndicator = this._addIndicator();
		setIconName(this._statusIndicator, 'bumblebee-active-symbolic');
		this._statusIndicator.visible = false;

		this._subMenuItem = new PopupMenu.PopupSubMenuMenuItem("Bumblebee", true);
		setIconName(this._subMenuItem.icon, 'bumblebee-active-symbolic');
		this._subMenuItem.setSensitive(false);
		this.menu.addMenuItem(this._subMenuItem);

		let appSystem = Shell.AppSystem.get_default();
		let nvidiaSettingsApp = appSystem.lookup_app('nvidia-settings.desktop');
		if (nvidiaSettingsApp) {
			this._subMenuItem.menu.addAction(nvidiaSettingsApp.get_name(),
					Lang.bind(this,
							function(source, app) {
								if (app.get_n_windows()) {
									app.activate();
								} else {
									Util.spawnCommandLine('optirun nvidia-settings --ctrl-display=:' + this._virtualDisplayNumber);
								}
							},
							nvidiaSettingsApp));
			this._subMenuItem.setSensitive(true);
		}

		let lockFile = Gio.File.new_for_path('/tmp/.X' + this._virtualDisplayNumber + '-lock');
		this._lockMonitor = lockFile.monitor_file(Gio.FileMonitorFlags.NONE, null);
		this._lockMonitorId = this._lockMonitor.connect('changed', Lang.bind(this, this._statusChanged));

		this._setStatus(lockFile.query_exists(null));
	}

	_parseBumblebeeConfigFile() {
		let bumblebeeConfigFile = Gio.File.new_for_path('/etc/bumblebee/bumblebee.conf');
		let bumblebeeConfigFileContents = bumblebeeConfigFile.load_contents(null);
		if (bumblebeeConfigFileContents[0]) {
			let match = /^VirtualDisplay=.*:(.*)$/m.exec(new String(bumblebeeConfigFileContents[1]));
			if (match) {
				this._virtualDisplayNumber = match[1].trim();
			}
		}

		if (!this._virtualDisplayNumber) {
			this._virtualDisplayNumber = '8';
		}
	}

	_getNvidiaActiveGpu() {
		try {
			// assumes bbswitch module is present
			let bbswitchStatusFile = Gio.File.new_for_path('/proc/acpi/bbswitch');
			let bbswitchStatusFileContents = bbswitchStatusFile.load_contents(null);
			if (bbswitchStatusFileContents[0]) {
				let match = /^(\S+)\s*ON$/m.exec(new String(bbswitchStatusFileContents[1]));
				if (match) {
					return match[1];
				}
			}
		} catch (e) {
		}
		return null;
	}

	_findGpuModelName() {
		if (this._gpuModelName) {
			return this._gpuModelName;
		}
		// TODO use /proc/acpi/bbswitch to find out the ID of the active GPU?
		try {
			let gpusFolder = Gio.File.new_for_path('/proc/driver/nvidia/gpus');
			let gpuFileEnumerator = gpusFolder.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
			let gpuIdFolderInfo = gpuFileEnumerator.next_file(null);
			if (gpuIdFolderInfo != null) {
				let gpuId = gpuIdFolderInfo.get_name();
				let gpuInfoFile = gpusFolder.resolve_relative_path(gpuId + '/information');
				let gpuInfoFileContents = gpuInfoFile.load_contents(null);
				if (gpuInfoFileContents[0]) {
					let match = /^Model:\s*(.*)$/m.exec(new String(gpuInfoFileContents[1]));
					if (match) {
						this._gpuModelName = match[1];
						return this._gpuModelName;
					}
				}
			}
		} catch (e) {
		}
		log("Could not find NVIDIA GPU model name, using general fallback.");
		return _("NVIDIA GPU");
	}

	_statusChanged(monitor, a_file, other_file, event_type) {
		if (event_type == Gio.FileMonitorEvent.CREATED) {
			this._setStatus(true);
		} else if (event_type ==  Gio.FileMonitorEvent.DELETED) {
			this._setStatus(false);
		}
	}

	_setStatus(active, notify) {
		this._statusIndicator.visible = active;
		let gpuModelName = this._findGpuModelName();
		if (active) {
			this._subMenuItem.label.text = _("%s On").format(gpuModelName);
			setIconName(this._subMenuItem.icon, 'bumblebee-active-symbolic');
		} else {
			this._subMenuItem.label.text = _("%s Off").format(gpuModelName);
			setIconName(this._subMenuItem.icon, 'bumblebee-inactive-symbolic');
		}
	}

	destroy() {
		this._lockMonitor.disconnect(this._lockMonitorId);
		this._lockMonitor.cancel();
		this.indicators.destroy();
		this.menu.destroy();
	}
});

let _bumblebeeIndicator;

function init(metadata) {
	let iconsDir = metadata.dir.get_child('icons');
	gicons = { 
		'bumblebee-active-symbolic': Gio.icon_new_for_string(iconsDir.get_child('bumblebee-active-symbolic.svg').get_path()),
		'bumblebee-inactive-symbolic': Gio.icon_new_for_string(iconsDir.get_child('bumblebee-inactive-symbolic.svg').get_path())
	};

	let localeDir = metadata.dir.get_child('locale');
	if (localeDir.query_exists(null)) {
		Gettext.bindtextdomain('gnome-shell-extension-bumblebee-status', localeDir.get_path());
	} else {
		Gettext.bindtextdomain('gnome-shell-extension-bumblebee-status', Config.LOCALEDIR);
	}
}

function enable() {
	_bumblebeeIndicator = new BumblebeeIndicator();

	let aggregateMenuPanelButton = Main.panel.statusArea['aggregateMenu'];
	let powerIndicator = aggregateMenuPanelButton._power;
	let powerSubmenuPosition = aggregateMenuPanelButton.menu._getMenuItems().indexOf(powerIndicator.menu);
	aggregateMenuPanelButton._indicators.insert_child_below(_bumblebeeIndicator.indicators, powerIndicator.indicators);
	aggregateMenuPanelButton.menu.addMenuItem(_bumblebeeIndicator.menu, powerSubmenuPosition);
}

function disable() {
	_bumblebeeIndicator.destroy();
	_bumblebeeIndicator = null;
}

