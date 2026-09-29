/**
 * Explains cron expressions in plain English. Supports the classic 5-field Unix form
 * and the 6-field Spring / Quartz form with seconds first.
 */

interface FieldSpec {
  name: string;
  plural: string;
  min: number;
  max: number;
  names?: string[];
}

const SECOND: FieldSpec = { name: 'second', plural: 'seconds', min: 0, max: 59 };
const MINUTE: FieldSpec = { name: 'minute', plural: 'minutes', min: 0, max: 59 };
const HOUR: FieldSpec = { name: 'hour', plural: 'hours', min: 0, max: 23 };
const DAY: FieldSpec = { name: 'day of month', plural: 'days', min: 1, max: 31 };
const MONTH: FieldSpec = {
  name: 'month', plural: 'months', min: 1, max: 12,
  names: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
};
const WEEKDAY: FieldSpec = {
  name: 'day of week', plural: 'days of week', min: 0, max: 7,
  names: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

function parseValue(raw: string, spec: FieldSpec): number {
  const upper = raw.toUpperCase();
  const index = spec.names?.indexOf(upper) ?? -1;
  const value = index >= 0 ? index + (spec === MONTH ? 1 : 0) : Number(raw);
  if (!Number.isInteger(value) || value < spec.min || value > spec.max) {
    throw new Error(`"${raw}" is out of range for ${spec.name} (${spec.min}-${spec.max})`);
  }
  return value;
}

function label(value: number, spec: FieldSpec): string {
  if (spec === MONTH) return MONTH_NAMES[value - 1];
  if (spec === WEEKDAY) return DAY_NAMES[value];
  return String(value);
}

interface Parsed {
  any: boolean;
  step: number | null;
  text: string;
  /** Single fixed value, if the field is just a number. */
  single: number | null;
}

function parseField(raw: string, spec: FieldSpec): Parsed {
  if (raw === '*' || raw === '?') {
    return { any: true, step: null, text: `every ${spec.name}`, single: null };
  }

  const parts = raw.split(',').map((part) => {
    const [range, stepRaw] = part.split('/');
    let step: number | null = null;
    if (stepRaw !== undefined) {
      step = Number(stepRaw);
      if (!Number.isInteger(step) || step <= 0) {
        throw new Error(`Invalid step "${stepRaw}" in ${spec.name}`);
      }
      if (step > spec.max) {
        throw new Error(`Step ${step} is larger than the ${spec.name} range (${spec.min}-${spec.max}), so it only ever matches ${spec.min}`);
      }
    }
    if (range === '*' || range === '?') {
      return { text: step ? `every ${step} ${spec.plural}` : `every ${spec.name}`, step, single: null };
    }
    if (range.includes('-')) {
      const [from, to] = range.split('-').map((v) => parseValue(v, spec));
      const base = `${label(from, spec)} through ${label(to, spec)}`;
      return { text: step ? `every ${step} ${spec.plural} from ${base}` : base, step, single: null };
    }
    const value = parseValue(range, spec);
    if (step) {
      return { text: `every ${step} ${spec.plural} starting at ${label(value, spec)}`, step, single: null };
    }
    return { text: label(value, spec), step: null, single: value };
  });

  const single = parts.length === 1 ? parts[0].single : null;
  const step = parts.length === 1 ? parts[0].step : null;
  return { any: false, step, single, text: joinList(parts.map((p) => p.text)) };
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function explainCron(input: string): string {
  let expression = input.trim().replace(/\s+/g, ' ');
  expression = MACROS[expression.toLowerCase()] ?? expression;
  const fields = expression.split(' ');

  let second: Parsed | null = null;
  let rest = fields;
  if (fields.length === 6) {
    second = parseField(fields[0], SECOND);
    rest = fields.slice(1);
  } else if (fields.length !== 5) {
    throw new Error('A cron expression has 5 fields (min hour day month weekday) or 6 with seconds first');
  }

  const [minute, hour, day, month, weekday] = [
    parseField(rest[0], MINUTE),
    parseField(rest[1], HOUR),
    parseField(rest[2], DAY),
    parseField(rest[3], MONTH),
    parseField(rest[4], WEEKDAY),
  ];

  const parts: string[] = [];

  // time of day
  if (minute.single !== null && hour.single !== null && (second === null || second.single !== null)) {
    const secs = second && second.single !== 0 ? `:${pad(second.single!)}` : '';
    parts.push(`At ${pad(hour.single)}:${pad(minute.single)}${secs}`);
  } else {
    const pureStep = (f: Parsed) => f.step !== null && f.text.startsWith('every ');
    if (second && second.single !== 0) {
      if (second.any) parts.push('every second');
      else if (pureStep(second)) parts.push(second.text);
      else parts.push(`at second ${second.text}`);
    }
    if (minute.any) {
      if (parts.length === 0) parts.push('every minute');
    } else if (pureStep(minute)) {
      parts.push(minute.text);
    } else {
      parts.push(`at minute ${minute.text}`);
    }
    if (!hour.any) {
      parts.push(pureStep(hour) ? hour.text : `past hour ${hour.text}`);
    }
  }

  if (!day.any) {
    parts.push(`on day ${day.text} of the month`);
  }
  if (!weekday.any) {
    parts.push(`on ${weekday.text}`);
  }
  if (!month.any) {
    parts.push(`in ${month.text}`);
  }

  let sentence = parts.join(', ').replace(/^at /, 'At ');
  sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  if (!day.any && !weekday.any) {
    sentence += ' (in Unix cron a day matching EITHER the day of month OR the weekday fires)';
  }
  return sentence;
}
