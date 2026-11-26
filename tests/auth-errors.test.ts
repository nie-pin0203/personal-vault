import {describe,it,expect} from 'vitest';
import {authErrorText} from '../src/App';
describe('safe actionable authentication errors',()=>{
 it('identifies email authorization and rate limits separately',()=>{
  expect(authErrorText({code:'email_address_not_authorized',status:403})).toContain('自定义 SMTP');
  expect(authErrorText({code:'over_email_send_rate_limit',status:429})).toContain('发送已达到限额');
 });
 it('preserves safe diagnostic codes and HTTP status',()=>{
  expect(authErrorText({code:'weak_password',status:422})).toContain('weak_password，HTTP 422');
 });
 it('never displays arbitrary server messages or malformed codes',()=>{
  const error={message:'private@example.test secret-password',code:'private@example.test',status:400};
  const result=authErrorText(error);
  expect(result).not.toContain('private@example.test');expect(result).not.toContain('secret-password');expect(result).toContain('unknown');
 });
 it('identifies a network failure without asserting an email problem',()=>{
  expect(authErrorText({name:'AuthRetryableFetchError',status:0})).toContain('检查网络');
 });
});
