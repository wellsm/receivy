import { UnprocessableEntityError } from '../common/errors';

export class TimelineOverflowError extends UnprocessableEntityError {
  constructor(message = 'O total financeiro deve estar entre -9007199254740991 e 9007199254740991 centavos.') {
    super(message, 'TIMELINE_OVERFLOW');
  }
}

export class InvalidTimelineFilterError extends UnprocessableEntityError {
  constructor(field: string, value: string) {
    super(`Filtro inválido: ${value}.`, 'TIMELINE_FILTER_INVALID', { [field]: value });
  }
}
