// A real consumer writes: require('electron-xpc/preload')
//
// Importing the preload entry is the whole job: it builds the xpcRenderer API
// and auto-exposes it on window via contextBridge. Renderer-side handlers and
// subscriptions are registered from renderer.js through that bridge, so the
// renderer layer itself is what the T2/T6/T9 cases exercise.
require('../dist/preload/index.js');
