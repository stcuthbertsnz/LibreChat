const path = require('path');
const { PermissionTypes, Permissions } = require('librechat-data-provider');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { silentExit } = require('./helpers');
const { getRoleByName, updateAccessPermissions } = require('~/models');
const connect = require('./connect');

(async () => {
  await connect();

  const roleName = process.argv[2];
  const allowedArg = process.argv[3];

  if (!roleName || !['true', 'false'].includes(allowedArg)) {
    console.orange(
      'Usage: node config/set-conversation-delete-permission.js <roleName> <true|false>',
    );
    console.orange(
      'Example: node config/set-conversation-delete-permission.js LibreChat-Student false',
    );
    silentExit(1);
    return;
  }

  const allowed = allowedArg === 'true';

  const role = await getRoleByName(roleName);
  if (!role) {
    console.red(`Error: No role named "${roleName}" was found!`);
    silentExit(1);
    return;
  }

  await updateAccessPermissions(
    roleName,
    { [PermissionTypes.CONVERSATIONS]: { [Permissions.DELETE]: allowed } },
    role,
  );

  console.green(`Set CONVERSATIONS.DELETE = ${allowed} for role "${roleName}"`);

  silentExit(0);
})();

process.on('uncaughtException', (err) => {
  console.error('There was an uncaught error:');
  console.error(err);
  process.exit(1);
});
