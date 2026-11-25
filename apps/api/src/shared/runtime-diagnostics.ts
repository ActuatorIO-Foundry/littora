// Never forward the exception passed by Node to a fatal handler to a container log.
export function installFatalDiagnostics(service: 'api' | 'worker' | 'member_login') {
  const stop = () => {
    process.stderr.write(JSON.stringify({event:'process_failed', service}) + '\n');
    process.exit(1);
  };
  process.once('uncaughtException', stop);
  process.once('unhandledRejection', stop);
}
