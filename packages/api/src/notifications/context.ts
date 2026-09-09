import { type NoticeContext, type NotificationVariables, notificationConfigFrom } from './planner';

type ProducerContext = {
  notificationQueue: NoticeContext['queue'];
  variables: NotificationVariables;
};

/** Notice context for HTTP handlers: rendering settings plus the queue they publish to. */
export function noticeContext(context: ProducerContext): NoticeContext {
  return { config: notificationConfigFrom(context.variables), queue: context.notificationQueue };
}
