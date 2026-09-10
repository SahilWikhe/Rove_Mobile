import { useCallback, useEffect, useRef, useState } from 'react';
import { Stack, router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { fetch as expoFetch } from 'expo/fetch';
import { z } from 'zod';
import { DriverDocumentReservation, DriverDocumentSummary } from '@rove/contracts';
import { ApiError } from '@rove/mobile-core';
import { sendDriverDocument } from '@rove/mobile-core/document-upload';
import { useSession } from '@rove/mobile-core/session';
import { Screen, Card, Copy, Button, Banner } from '@rove/mobile-ui';
import { pickDriverDocument } from '../documents/pick-document';

const names = {
  driver_license: 'Driver’s license',
  vehicle_registration: 'Vehicle registration',
  vehicle_insurance: 'Vehicle insurance',
};
const verificationCopy = {
  pending: 'Uploaded. Verification is pending.',
  awaiting_review: 'File verified. Awaiting document review.',
  replacement_required: 'We could not accept this file. Upload a different copy.',
  delayed: 'File verification needs attention. Contact support for help.',
};
type Kind = z.infer<typeof DriverDocumentReservation>['kind'];
type Pending = { id: string; key: string };
export default function Documents() {
  const { profile } = useSession();
  return <DocumentScreen key={profile?.id ?? 'signed-out'} />;
}
function DocumentScreen() {
  const { profile, api, synthetic } = useSession();
  const [documents, setDocuments] = useState<z.infer<typeof DriverDocumentSummary>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const reads = useRef(0);
  const mounted = useRef(true);
  const active = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    const generation = ++reads.current;
    if (mounted.current) setDocuments(null);
    const result = await api.driverDocuments();
    if (mounted.current && reads.current === generation) setDocuments(result.documents);
  }, [api]);
  useEffect(() => {
    mounted.current = true;
    if (profile)
      void refresh().catch(() => {
        if (mounted.current) setError('Unable to load documents. Try refreshing.');
      });
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, [profile, refresh]);
  async function run(kind?: Kind) {
    if (active.current || !profile) return;
    const controller = new AbortController();
    active.current = controller;
    setError(null);
    setPhase(kind ? 'Choose a document…' : 'Verifying upload…');
    let selection: Awaited<ReturnType<typeof pickDriverDocument>> = null;
    try {
      let completion = pending;
      if (kind) {
        selection = await pickDriverDocument();
        if (!selection || controller.signal.aborted || !mounted.current) return;
        const reservation = DriverDocumentReservation.parse({
          id: Crypto.randomUUID(),
          kind,
          bytes: selection.file.size,
          contentType: selection.file.type,
          sha256: selection.sha256,
        });
        setPhase('Preparing secure upload…');
        await api.reserveDriverDocument(reservation, controller.signal);
        const target = await api.driverDocumentUploadTarget(reservation.id, controller.signal);
        if (controller.signal.aborted || !mounted.current) return;
        setPhase('Uploading document…');
        await sendDriverDocument(target, reservation, selection.file, controller.signal, (url, options) =>
          expoFetch(url, options),
        );
        completion = { id: reservation.id, key: target.key };
        if (mounted.current) setPending(completion);
      }
      if (!completion || controller.signal.aborted || !mounted.current) return;
      setPhase('Verifying upload…');
      await api.completeDriverDocument(completion.id, completion.key, controller.signal);
      if (mounted.current) setPending(null);
      await refresh();
    } catch (cause) {
      if (
        mounted.current &&
        cause instanceof ApiError &&
        ['DOCUMENT_EXPIRED', 'DOCUMENT_NOT_FOUND', 'DOCUMENT_UPLOAD_UNVERIFIED', 'INVALID_DOCUMENT'].includes(
          cause.code,
        )
      ) {
        setPending(null);
        void refresh().catch(() => {
          /* Keep the actionable upload error below. */
        });
      }
      if (mounted.current)
        setError(
          cause instanceof ApiError
            ? cause.message
            : 'The document could not be uploaded. Choose a JPEG, PNG or PDF up to 10 MB and try again.',
        );
    } finally {
      active.current = null;
      if (mounted.current) setPhase(null);
      selection?.dispose();
    }
  }
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Your documents' }} />
      <Copy kind="title">Ready for review.</Copy>
      <Copy>
        Upload clear copies of your driving documents. Uploading does not confirm approval to drive.
      </Copy>
      {synthetic && <Banner message="Use synthetic documents only in this preview." />}
      {!profile ? (
        <Button title="Sign in" onPress={() => router.replace('/')} />
      ) : (
        <>
          {error && <Banner error message={error} />}
          {phase && <Copy>{phase}</Copy>}
          {pending && (
            <Button title="Retry upload verification" disabled={!!phase} onPress={() => void run()} />
          )}
          {(Object.keys(names) as Kind[]).map((kind) => {
            const latest = documents?.find((item) => item.kind === kind);
            return (
              <Card key={kind}>
                <Copy kind="heading">{names[kind]}</Copy>
                <Copy kind="muted">
                  {!documents
                    ? 'Checking document status…'
                    : latest?.state === 'quarantined'
                      ? verificationCopy[latest.verification ?? 'pending']
                      : latest?.state === 'expired'
                        ? 'Previous upload expired.'
                        : latest
                          ? 'Previous upload is incomplete.'
                          : 'No document uploaded yet.'}
                </Copy>
                <Button
                  title={`${latest?.verification === 'replacement_required' ? 'Replace' : 'Choose'} ${names[kind].toLowerCase()}`}
                  variant="secondary"
                  disabled={!!phase || !!pending || !documents}
                  onPress={() => void run(kind)}
                />
              </Card>
            );
          })}
          {documents?.some((item) => item.verification === 'delayed') && (
            <Button
              title="Get document help"
              variant="secondary"
              disabled={!!phase || !!pending}
              onPress={() => router.push('/support')}
            />
          )}
          <Copy kind="muted">JPEG, PNG or PDF · Up to 10 MB each. Keep every edge readable.</Copy>
          <Button
            title="Refresh documents"
            variant="secondary"
            disabled={!!phase}
            onPress={() => {
              setError(null);
              void refresh().catch(() => setError('Unable to refresh documents. Try again.'));
            }}
          />
        </>
      )}
    </Screen>
  );
}
