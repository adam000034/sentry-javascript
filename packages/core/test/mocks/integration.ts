import { getCurrentHub } from '@sentry/hub';
import { configureScope } from '@sentry/minimal';
import { SentryEvent, Integration } from '@sentry/types';

export class TestIntegration implements Integration {
  public static id: string = 'TestIntegration';

  public name: string = 'TestIntegration';

  public setupOnce(): void {
    configureScope(scope => {
      scope.addEventProcessor((event: SentryEvent) => {
        if (!getCurrentHub().getIntegration(TestIntegration)) {
          return event;
        }

        return null;
      });
    });
  }
}
