/**
 * Host half of the in-session page search bundle.
 *
 * The capability lives entirely in the browser: the Client half registers a
 * find bar in the frame-wide `shell.overlay` seat, searches the rendered text
 * of the current page, paints matches with the CSS Custom Highlight API and
 * navigates between them. This Host module therefore stays inert, it exists so
 * the bundle has the Loader row its `dsh.client` half hangs from.
 */
export function apply() {}
