import { NestFactory } from '@nestjs/core';
import { GoogleLoginModule, secureLoginResponses } from './member-login/google-login.module';
import { SessionIssuer } from './member-login/login-settings';
import { installFatalDiagnostics } from './shared/runtime-diagnostics';

async function bootstrap() {
  const app = await NestFactory.create(GoogleLoginModule, {logger:false, abortOnError:false, bodyParser:false});
  try {
    await app.get(SessionIssuer).ready();
    secureLoginResponses(app);
    app.enableShutdownHooks();
    await app.listen(Number(process.env.MEMBER_LOGIN_PORT ?? 3101), '127.0.0.1');
  } catch (error) { await app.close(); throw error; }
}

installFatalDiagnostics('member_login');
bootstrap().catch(() => {
  console.error('{"event":"member_login_startup_failed"}');
  process.exit(1);
});
