/** Escapes a value for insertion into HTML (email bodies, certificate
 * markup). Anything a user typed — names, remarks, comments — must go
 * through this, or it can inject its own markup/links into official mail. */
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

module.exports = { escapeHtml };
