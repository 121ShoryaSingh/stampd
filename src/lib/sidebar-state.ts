// Shared by the server layout (reads it) and the client sidebar (writes it). Not in the "use client"
// sidebar module: a server component importing a value from there gets a client reference, not the string.
export const SIDEBAR_COOKIE_NAME = "sidebar_state";
