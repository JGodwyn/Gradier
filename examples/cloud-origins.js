// Cloud dev environments serve the examples from their own preview domains.
// Allow those for the demo only; your own project needs none of this when it runs on localhost.
export const cloudOrigins = [
  'https://*.app.github.dev', // GitHub Codespaces
  'https://*.webcontainer-api.io', // StackBlitz
  'https://*.webcontainer.io',
  'https://*.csb.app', // CodeSandbox
  'https://*.gitpod.io', // Gitpod
];

export const cloudServer = {
  host: process.env.CODESPACES || process.env.GITPOD_WORKSPACE_ID || process.env.CODESANDBOX_HOST ? true : undefined,
  allowedHosts: ['.app.github.dev', '.csb.app', '.gitpod.io'],
};
