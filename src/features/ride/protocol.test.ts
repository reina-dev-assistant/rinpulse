import { describe, expect, it } from 'bun:test';

import {
  CAN_SEND,
  FORWARD,
  MAX_MESSAGE_BYTES,
  PING_TEXT,
  PONG_TEXT,
  canSend,
  codeFromText,
  encode,
  isRoomCode,
  joinLink,
  parseMessage,
  utf8Length,
  wsPath,
  type RideMsg,
} from './protocol';

const ok = (raw: string): RideMsg => {
  const result = parseMessage(raw);
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}: ${raw}`);
  return result.msg;
};
const reason = (raw: string) => {
  const result = parseMessage(raw);
  return result.ok ? 'ok' : result.reason;
};

describe('parseMessage: sensor samples', () => {
  it('keeps the fields that are there and nothing else', () => {
    expect(ok('{"t":"s","v":1,"ts":1760000000000,"hr":132,"cad":88.5,"extra":"x"}')).toEqual({ t: 's', v: 1, ts: 1760000000000, hr: 132, cad: 88.5 });
  });

  it('a missing field means no data; pwr stays absent', () => {
    const msg = ok('{"t":"s","v":1,"ts":5,"cad":0}');
    expect(msg).toEqual({ t: 's', v: 1, ts: 5, cad: 0 });
    expect('pwr' in msg).toBe(false);
  });

  it('takes RR intervals and drops an empty list', () => {
    expect(ok('{"t":"s","v":1,"ts":5,"rr":[812,805]}')).toEqual({ t: 's', v: 1, ts: 5, rr: [812, 805] });
    expect(ok('{"t":"s","v":1,"ts":5,"rr":[]}')).toEqual({ t: 's', v: 1, ts: 5 });
  });

  it('refuses out-of-range, non-numeric, missing-ts and over-long fields', () => {
    expect(reason('{"t":"s","v":1,"ts":5,"hr":999}')).toBe('bad_message');
    expect(reason('{"t":"s","v":1,"ts":5,"hr":"80"}')).toBe('bad_message');
    expect(reason('{"t":"s","v":1,"ts":5,"cad":-1}')).toBe('bad_message');
    expect(reason('{"t":"s","v":1,"hr":80}')).toBe('bad_message');
    expect(reason(`{"t":"s","v":1,"ts":5,"rr":[${new Array(17).fill(800).join(',')}]}`)).toBe('bad_message');
    expect(reason('{"t":"s","v":1,"ts":5,"rr":[800,"x"]}')).toBe('bad_message');
  });

  it('a null field is the same as missing', () => {
    expect(ok('{"t":"s","v":1,"ts":5,"hr":null}')).toEqual({ t: 's', v: 1, ts: 5 });
  });
});

describe('parseMessage: other messages', () => {
  it('hello with the rider mass', () => {
    expect(ok('{"t":"hello","v":1,"role":"phone","app":"JoyoFit 1.0","massKg":72.5}')).toEqual({ t: 'hello', v: 1, role: 'phone', app: 'JoyoFit 1.0', massKg: 72.5 });
    expect(ok('{"t":"hello","v":1,"role":"web","app":"Ride"}')).toEqual({ t: 'hello', v: 1, role: 'web', app: 'Ride' });
    expect(reason('{"t":"hello","v":1,"role":"admin","app":"x"}')).toBe('bad_message');
    expect(reason('{"t":"hello","v":1,"role":"phone","app":"x","massKg":5}')).toBe('bad_message');
    expect(reason(`{"t":"hello","v":1,"role":"phone","app":"${'x'.repeat(41)}"}`)).toBe('bad_message');
  });

  it('ctl actions', () => {
    for (const action of ['start', 'pause', 'resume', 'lap', 'stop']) expect(ok(`{"t":"ctl","v":1,"action":"${action}"}`)).toEqual({ t: 'ctl', v: 1, action: action as 'start' });
    expect(reason('{"t":"ctl","v":1,"action":"explode"}')).toBe('bad_message');
  });

  it('gear steps are +1 or -1', () => {
    expect(ok('{"t":"gear","v":1,"d":-1}')).toEqual({ t: 'gear', v: 1, d: -1 });
    expect(reason('{"t":"gear","v":1,"d":2}')).toBe('bad_message');
  });

  it('game state', () => {
    const raw = '{"t":"st","v":1,"gear":6,"gearCount":16,"route":"Bukit","phase":"riding","distM":1234.56,"elevM":40,"grade":3.14159,"vKmh":28.04,"pwrEst":183.4}';
    expect(ok(raw)).toEqual({ t: 'st', v: 1, gear: 6, gearCount: 16, route: 'Bukit', phase: 'riding', distM: 1234.6, elevM: 40, grade: 3.1, vKmh: 28, pwrEst: 183 });
    expect(reason(raw.replace('riding', 'flying'))).toBe('bad_message');
    expect(reason(raw.replace('"pwrEst":183.4', '"pwrEst":-1'))).toBe('bad_message');
  });

  it('summary with laps', () => {
    const raw = '{"t":"sum","v":1,"distM":10234.5,"elevM":120,"route":"Bukit","laps":[{"sec":600.04,"distM":5100},{"sec":610,"distM":5134.5}]}';
    expect(ok(raw)).toEqual({ t: 'sum', v: 1, distM: 10234.5, elevM: 120, route: 'Bukit', laps: [{ sec: 600, distM: 5100 }, { sec: 610, distM: 5134.5 }] });
    expect(reason(raw.replace('"laps":[', '"laps":[7,'))).toBe('bad_message');
    const many = JSON.stringify({ t: 'sum', v: 1, distM: 1, elevM: 1, route: 'r', laps: new Array(31).fill({ sec: 1, distM: 1 }) });
    expect(utf8Length(many)).toBeLessThan(MAX_MESSAGE_BYTES);
    expect(reason(many)).toBe('bad_message');
  });

  it('ack, room and err', () => {
    expect(ok('{"t":"ack","v":1,"of":"sum"}')).toEqual({ t: 'ack', v: 1, of: 'sum' });
    expect(ok('{"t":"room","v":1,"phone":true,"webs":2,"expiresAt":1760000000000}')).toEqual({ t: 'room', v: 1, phone: true, webs: 2, expiresAt: 1760000000000 });
    expect(ok('{"t":"err","v":1,"code":"rate_limited"}')).toEqual({ t: 'err', v: 1, code: 'rate_limited' });
    expect(reason('{"t":"err","v":1,"code":"nope"}')).toBe('bad_message');
  });

  it('ping and pong need no version', () => {
    expect(ok(PING_TEXT)).toEqual({ t: 'ping' });
    expect(ok(PONG_TEXT)).toEqual({ t: 'pong' });
  });
});

describe('parseMessage: refusals', () => {
  it('not JSON, not an object, no type, unknown type, wrong version', () => {
    expect(reason('hello')).toBe('bad_message');
    expect(reason('[]')).toBe('bad_message');
    expect(reason('null')).toBe('bad_message');
    expect(reason('{"v":1}')).toBe('bad_message');
    expect(reason('{"t":"nuke","v":1}')).toBe('bad_message');
    expect(reason('{"t":"ctl","v":2,"action":"stop"}')).toBe('bad_message');
    expect(reason('{"t":"ctl","action":"stop"}')).toBe('bad_message');
  });

  it('a frame over 2 KB is too_large before it is even parsed, counted in UTF-8 bytes', () => {
    expect(reason(`{"t":"hello","v":1,"role":"web","app":"${'a'.repeat(MAX_MESSAGE_BYTES)}"}`)).toBe('too_large');
    const emoji = '\u{1F6B4}'.repeat(520);
    expect(emoji.length).toBe(1040);
    expect(utf8Length(emoji)).toBe(2080);
    expect(reason(emoji)).toBe('too_large');
    expect(reason(' '.repeat(MAX_MESSAGE_BYTES) + '{}')).toBe('too_large');
  });
});

describe('utf8Length', () => {
  it('counts ascii, two, three and four byte characters and lone surrogates', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('\u00e9')).toBe(2);
    expect(utf8Length('\u20ac')).toBe(3);
    expect(utf8Length('\u{1F6B4}')).toBe(4);
    expect(utf8Length('\ud800')).toBe(3);
    for (const text of ['', 'Kayuh', 'jam-mu \u00e9\u20ac\u{1F6B4}x']) expect(utf8Length(text)).toBe(new TextEncoder().encode(text).length);
  });
});

describe('who may send what', () => {
  it('the phone sends samples and gear, the web sends state and the summary', () => {
    expect(canSend('phone', 's')).toBe(true);
    expect(canSend('web', 's')).toBe(false);
    expect(canSend('web', 'st')).toBe(true);
    expect(canSend('phone', 'st')).toBe(false);
    expect(canSend('web', 'sum')).toBe(true);
    expect(canSend('phone', 'sum')).toBe(false);
    expect(canSend('phone', 'gear')).toBe(true);
    expect(canSend('web', 'gear')).toBe(false);
    expect(canSend('phone', 'room')).toBe(false);
    expect(canSend('web', 'err')).toBe(false);
  });

  it('what is forwarded is a subset of what may be sent, and acks stay in the relay', () => {
    for (const role of ['phone', 'web'] as const) for (const t of FORWARD[role]) expect(CAN_SEND[role]).toContain(t);
    expect(FORWARD.phone).not.toContain('ack');
  });
});

describe('room helpers', () => {
  it('a code is six digits', () => {
    expect(isRoomCode('123456')).toBe(true);
    expect(isRoomCode('12345')).toBe(false);
    expect(isRoomCode('1234567')).toBe(false);
    expect(isRoomCode('12345a')).toBe(false);
    expect(isRoomCode(123456)).toBe(false);
  });

  it('the deep link round-trips and codeFromText reads links, bare and spaced codes', () => {
    expect(joinLink('048213')).toBe('joyofit://ride/join?code=048213');
    expect(codeFromText(joinLink('048213'))).toBe('048213');
    expect(codeFromText('https://fit.joyorogo.com/ride?x=1&code=048213')).toBe('048213');
    expect(codeFromText(' 048 213 ')).toBe('048213');
    expect(codeFromText('048-213')).toBe('048213');
    expect(codeFromText('joyofit://ride/join?code=0482131')).toBeNull();
    expect(codeFromText('hello')).toBeNull();
    expect(codeFromText('')).toBeNull();
  });

  it('wsPath carries the role and an encoded token', () => {
    expect(wsPath('abc', 'phone', 'a+b/c')).toBe('/ride/rooms/abc/ws?role=phone&token=a%2Bb%2Fc');
  });

  it('encode is plain JSON', () => {
    expect(encode({ t: 'ctl', v: 1, action: 'lap' })).toBe('{"t":"ctl","v":1,"action":"lap"}');
  });
});
