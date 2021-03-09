/**
 * @jest-environment jsdom
 */

import { expect } from 'chai';
import { fakeServer, SinonFakeServer, stub } from 'sinon';
import { SentryEvent, Status } from '@sentry/types';
import { eventToTransportRequest } from '@sentry/transport-base';

import { XHRTransport } from '../src/index';

const testDsn = 'https://123@sentry.io/42';
const storeUrl = 'https://sentry.io/api/42/store/?sentry_key=123&sentry_version=7';
const envelopeUrl = 'https://sentry.io/api/42/envelope/?sentry_key=123&sentry_version=7';
const eventPayload: SentryEvent = {
  event_id: '1337',
};
const transactionPayload: SentryEvent = {
  event_id: '42',
  type: 'transaction',
};

let server: SinonFakeServer;
let transport: XHRTransport;

// TODO: Rework these tests after transports are complete
describe.skip('XHRTransport', () => {
  beforeEach(() => {
    server = fakeServer.create();
    server.respondImmediately = true;
    transport = new XHRTransport({ dsn: testDsn });
  });

  afterEach(() => {
    server.restore();
  });

  describe('sendRequest()', () => {
    it('sends a request to Sentry servers', async () => {
      server.respondWith('POST', storeUrl, [200, {}, '']);

      const req = eventToTransportRequest(eventPayload);
      const res = await transport.sendRequest(req);

      expect(res.status).equal(Status.Success);
      const request = server.requests[0];
      expect(server.requests.length).equal(1);
      expect(request.method).equal('POST');
      expect(JSON.parse(request.requestBody)).deep.equal(eventToTransportRequest(eventPayload));
    });

    it('rejects with non-200 status code', async () => {
      server.respondWith('POST', storeUrl, [403, {}, '']);

      try {
        await transport.sendRequest(eventToTransportRequest(eventPayload));
      } catch (res) {
        expect(res.status).equal(403);
        const request = server.requests[0];
        expect(server.requests.length).equal(1);
        expect(request.method).equal('POST');
        expect(JSON.parse(request.requestBody)).deep.equal(eventToTransportRequest(eventPayload));
      }
    });

    it('passes in headers', async () => {
      transport = new XHRTransport({
        dsn: testDsn,
        headers: {
          Authorization: 'Basic GVzdDp0ZXN0Cg==',
        },
      });

      server.respondWith('POST', storeUrl, [200, {}, '']);
      const res = await transport.sendRequest(eventToTransportRequest(eventPayload));
      const request = server.requests[0];

      expect(res.status).equal(Status.Success);
      const requestHeaders: { [key: string]: string } = request.requestHeaders as { [key: string]: string };
      const authHeaderLabel = 'Authorization';
      expect(requestHeaders[authHeaderLabel]).equal('Basic GVzdDp0ZXN0Cg==');
    });

    describe('Rate-limiting', () => {
      it('back-off using Retry-After header', async () => {
        const retryAfterSeconds = 10;
        const beforeLimit = Date.now();
        const withinLimit = beforeLimit + (retryAfterSeconds / 2) * 1000;
        const afterLimit = beforeLimit + retryAfterSeconds * 1000;

        server.respondWith('POST', storeUrl, [429, { 'Retry-After': `${retryAfterSeconds}` }, '']);

        const dateStub = stub(Date, 'now')
          // 1st event - _isRateLimited - false
          .onCall(0)
          .returns(beforeLimit)
          // 1st event - _handleRateLimit
          .onCall(1)
          .returns(beforeLimit)
          // 2nd event - _isRateLimited - true
          .onCall(2)
          .returns(withinLimit)
          // 3rd event - _isRateLimited - false
          .onCall(3)
          .returns(afterLimit)
          // 3rd event - _handleRateLimit
          .onCall(4)
          .returns(afterLimit);

        try {
          await transport.sendRequest(eventToTransportRequest(eventPayload));
          throw new Error('unreachable!');
        } catch (res) {
          expect(res.status).equal(429);
          expect(res.reason).equal(undefined);
          expect(server.requests.length).equal(1);
        }

        try {
          await transport.sendRequest(eventToTransportRequest(eventPayload));
          throw new Error('unreachable!');
        } catch (res) {
          expect(res.status).equal(429);
          expect(res.reason).equal(`Transport locked till ${new Date(afterLimit)} due to too many requests.`);
          expect(server.requests.length).equal(1);
        }

        server.respondWith('POST', storeUrl, [200, {}, '']);

        const eventRes = await transport.sendRequest(eventToTransportRequest(eventPayload));
        expect(eventRes.status).equal(Status.Success);
        expect(server.requests.length).equal(2);

        dateStub.restore();
      });

      it('back-off using X-Sentry-Rate-Limits with single category', async () => {
        const retryAfterSeconds = 10;
        const beforeLimit = Date.now();
        const withinLimit = beforeLimit + (retryAfterSeconds / 2) * 1000;
        const afterLimit = beforeLimit + retryAfterSeconds * 1000;

        server.respondWith('POST', storeUrl, [429, { 'X-Sentry-Rate-Limits': `${retryAfterSeconds}:event:scope` }, '']);
        server.respondWith('POST', envelopeUrl, [200, {}, '']);

        const dateStub = stub(Date, 'now')
          // 1st event - _isRateLimited - false
          .onCall(0)
          .returns(beforeLimit)
          // 1st event - _handleRateLimit
          .onCall(1)
          .returns(beforeLimit)
          // 2nd event - _isRateLimited - false (different category)
          .onCall(2)
          .returns(withinLimit)
          // 2nd event - _handleRateLimit
          .onCall(3)
          .returns(withinLimit)
          // 3rd event - _isRateLimited - true
          .onCall(4)
          .returns(withinLimit)
          // 4th event - _isRateLimited - false
          .onCall(5)
          .returns(afterLimit)
          // 4th event - _handleRateLimit
          .onCall(6)
          .returns(afterLimit);

        try {
          await transport.sendRequest(eventToTransportRequest(eventPayload));
          throw new Error('unreachable!');
        } catch (res) {
          expect(res.status).equal(429);
          expect(res.reason).equal(undefined);
          expect(server.requests.length).equal(1);
        }

        const transactionRes = await transport.sendRequest(eventToTransportRequest(transactionPayload));
        expect(transactionRes.status).equal(Status.Success);
        expect(server.requests.length).equal(2);

        try {
          await transport.sendRequest(eventToTransportRequest(eventPayload));
          throw new Error('unreachable!');
        } catch (res) {
          expect(res.status).equal(429);
          expect(res.reason).equal(`Transport locked till ${new Date(afterLimit)} due to too many requests.`);
          expect(server.requests.length).equal(2);
        }

        server.respondWith('POST', storeUrl, [200, {}, '']);

        const eventRes = await transport.sendRequest(eventToTransportRequest(eventPayload));
        expect(eventRes.status).equal(Status.Success);
        expect(server.requests.length).equal(3);

        dateStub.restore();
      });

      it('back-off using X-Sentry-Rate-Limits with multiple categories', async () => {
        const retryAfterSeconds = 10;
        const beforeLimit = Date.now();
        const withinLimit = beforeLimit + (retryAfterSeconds / 2) * 1000;
        const afterLimit = beforeLimit + retryAfterSeconds * 1000;

        server.respondWith('POST', storeUrl, [
          429,
          { 'X-Sentry-Rate-Limits': `${retryAfterSeconds}:event;transaction:scope` },
          '',
        ]);
        server.respondWith('POST', envelopeUrl, [200, {}, '']);

        const dateStub = stub(Date, 'now')
          // 1st event - _isRateLimited - false
          .onCall(0)
          .returns(beforeLimit)
          // 1st event - _handleRateLimit
          .onCall(1)
          .returns(beforeLimit)
          // 2nd event - _isRateLimited - true (event category)
          .onCall(2)
          .returns(withinLimit)
          // 3rd event - _isRateLimited - true (transaction category)
          .onCall(3)
          .returns(withinLimit)
          // 4th event - _isRateLimited - false (event category)
          .onCall(4)
          .returns(afterLimit)
          // 4th event - _handleRateLimit
          .onCall(5)
          .returns(afterLimit)
          // 5th event - _isRateLimited - false (transaction category)
          .onCall(6)
          .returns(afterLimit)
          // 5th event - _handleRateLimit
          .onCall(7)
          .returns(afterLimit);

        try {
          await transport.sendRequest(eventToTransportRequest(eventPayload));
          throw new Error('unreachable!');
        } catch (res) {
          expect(res.status).equal(429);
          expect(res.reason).equal(undefined);
          expect(server.requests.length).equal(1);
        }

        try {
          await transport.sendRequest(eventToTransportRequest(eventPayload));
          throw new Error('unreachable!');
        } catch (res) {
          expect(res.status).equal(429);
          expect(res.reason).equal(`Transport locked till ${new Date(afterLimit)} due to too many requests.`);
          expect(server.requests.length).equal(1);
        }

        try {
          await transport.sendRequest(eventToTransportRequest(transactionPayload));
          throw new Error('unreachable!');
        } catch (res) {
          expect(res.status).equal(429);
          expect(res.reason).equal(`Transport locked till ${new Date(afterLimit)} due to too many requests.`);
          expect(server.requests.length).equal(1);
        }

        server.respondWith('POST', storeUrl, [200, {}, '']);
        server.respondWith('POST', envelopeUrl, [200, {}, '']);

        const eventRes = await transport.sendRequest(eventToTransportRequest(eventPayload));
        expect(eventRes.status).equal(Status.Success);
        expect(server.requests.length).equal(2);

        const transactionRes = await transport.sendRequest(eventToTransportRequest(transactionPayload));
        expect(transactionRes.status).equal(Status.Success);
        expect(server.requests.length).equal(3);

        dateStub.restore();
      });

      it('back-off using X-Sentry-Rate-Limits with missing categories should lock them all', async () => {
        const retryAfterSeconds = 10;
        const beforeLimit = Date.now();
        const withinLimit = beforeLimit + (retryAfterSeconds / 2) * 1000;
        const afterLimit = beforeLimit + retryAfterSeconds * 1000;

        server.respondWith('POST', storeUrl, [429, { 'X-Sentry-Rate-Limits': `${retryAfterSeconds}::scope` }, '']);
        server.respondWith('POST', envelopeUrl, [200, {}, '']);

        const dateStub = stub(Date, 'now')
          // 1st event - _isRateLimited - false
          .onCall(0)
          .returns(beforeLimit)
          // 1st event - _handleRateLimit
          .onCall(1)
          .returns(beforeLimit)
          // 2nd event - _isRateLimited - true (event category)
          .onCall(2)
          .returns(withinLimit)
          // 3rd event - _isRateLimited - true (transaction category)
          .onCall(3)
          .returns(withinLimit)
          // 4th event - _isRateLimited - false (event category)
          .onCall(4)
          .returns(afterLimit)
          // 4th event - _handleRateLimit
          .onCall(5)
          .returns(afterLimit)
          // 5th event - _isRateLimited - false (transaction category)
          .onCall(6)
          .returns(afterLimit)
          // 5th event - _handleRateLimit
          .onCall(7)
          .returns(afterLimit);

        try {
          await transport.sendRequest(eventToTransportRequest(eventPayload));
          throw new Error('unreachable!');
        } catch (res) {
          expect(res.status).equal(429);
          expect(res.reason).equal(undefined);
          expect(server.requests.length).equal(1);
        }

        try {
          await transport.sendRequest(eventToTransportRequest(eventPayload));
          throw new Error('unreachable!');
        } catch (res) {
          expect(res.status).equal(429);
          expect(res.reason).equal(`Transport locked till ${new Date(afterLimit)} due to too many requests.`);
          expect(server.requests.length).equal(1);
        }

        try {
          await transport.sendRequest(eventToTransportRequest(transactionPayload));
          throw new Error('unreachable!');
        } catch (res) {
          expect(res.status).equal(429);
          expect(res.reason).equal(`Transport locked till ${new Date(afterLimit)} due to too many requests.`);
          expect(server.requests.length).equal(1);
        }

        server.respondWith('POST', storeUrl, [200, {}, '']);
        server.respondWith('POST', envelopeUrl, [200, {}, '']);

        const eventRes = await transport.sendRequest(eventToTransportRequest(eventPayload));
        expect(eventRes.status).equal(Status.Success);
        expect(server.requests.length).equal(2);

        const transactionRes = await transport.sendRequest(eventToTransportRequest(transactionPayload));
        expect(transactionRes.status).equal(Status.Success);
        expect(server.requests.length).equal(3);

        dateStub.restore();
      });

      it('back-off using X-Sentry-Rate-Limits should also trigger for 200 responses', async () => {
        const retryAfterSeconds = 10;
        const beforeLimit = Date.now();
        const withinLimit = beforeLimit + (retryAfterSeconds / 2) * 1000;
        const afterLimit = beforeLimit + retryAfterSeconds * 1000;

        server.respondWith('POST', storeUrl, [200, { 'X-Sentry-Rate-Limits': `${retryAfterSeconds}:event:scope` }, '']);

        const dateStub = stub(Date, 'now')
          // 1st event - _isRateLimited - false
          .onCall(0)
          .returns(beforeLimit)
          // 1st event - _handleRateLimit
          .onCall(1)
          .returns(beforeLimit)
          // 2nd event - _isRateLimited - true
          .onCall(2)
          .returns(withinLimit)
          // 3rd event - _isRateLimited - false
          .onCall(3)
          .returns(afterLimit)
          // 3rd event - _handleRateLimit
          .onCall(4)
          .returns(afterLimit);

        let eventRes = await transport.sendRequest(eventToTransportRequest(eventPayload));
        expect(eventRes.status).equal(Status.Success);
        expect(server.requests.length).equal(1);

        try {
          await transport.sendRequest(eventToTransportRequest(eventPayload));
          throw new Error('unreachable!');
        } catch (res) {
          expect(res.status).equal(429);
          expect(res.reason).equal(`Transport locked till ${new Date(afterLimit)} due to too many requests.`);
          expect(server.requests.length).equal(1);
        }

        server.respondWith('POST', storeUrl, [200, {}, '']);

        eventRes = await transport.sendRequest(eventToTransportRequest(eventPayload));
        expect(eventRes.status).equal(Status.Success);
        expect(server.requests.length).equal(2);

        dateStub.restore();
      });
    });
  });
});
