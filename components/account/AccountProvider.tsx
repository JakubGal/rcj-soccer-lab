'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  AccountApiError,
  finishCertificationGame,
  getAccount,
  getCertificationState,
  patchAccount,
  restartCertification,
  startCertification,
  startCertificationGame,
  submitRuleLearningEvent,
  type AccountLoadStatus,
  type AccountProfilePatch,
  type AccountSnapshot,
  type CertificationGameLaunch,
  type FinishGamePayload,
  type StartGamePayload,
} from '@/lib/account';
import type {
  RefereePracticeTrackingBridge,
  RuleLearningBridge,
  RuleLearningEvent,
} from '@/lib/certification/client-types';

const DEFAULT_SECURE_APP_URL = 'https://rcj-soccer-lab.bukajlag.chatgpt.site/';

export type AccountContextValue = {
  status: AccountLoadStatus;
  account: AccountSnapshot | null;
  error: string | null;
  busyAction: string | null;
  apiBaseUrl: string;
  secureAppUrl: string;
  isStaticHost: boolean;
  refresh: () => Promise<AccountSnapshot | null>;
  updateProfile: (patch: AccountProfilePatch) => Promise<void>;
  beginCertification: () => Promise<void>;
  resetCertification: () => Promise<void>;
  beginCertificationGame: (
    payload: StartGamePayload,
  ) => Promise<CertificationGameLaunch>;
  completeCertificationGame: (
    attemptId: string,
    payload: FinishGamePayload,
  ) => Promise<void>;
  recordRuleLearning: (event: RuleLearningEvent) => Promise<boolean>;
  practiceRuleLearningBridge: RuleLearningBridge;
  certificationRuleLearningBridge: RuleLearningBridge;
  practiceTrackingBridge: RefereePracticeTrackingBridge;
  signIn: () => void;
  signOut: () => void;
  openSecureApp: (page?: string) => void;
};

const AccountContext = createContext<AccountContextValue | null>(null);

function currentReturnTo(page = 'profile') {
  const url = new URL(window.location.href);
  url.searchParams.set('mode', 'academy');
  url.searchParams.set('academy', page);
  return `${url.pathname}${url.search}${url.hash}`;
}

function isGitHubPagesHost() {
  return (
    typeof window !== 'undefined' &&
    window.location.hostname.toLowerCase().endsWith('.github.io')
  );
}

export function AccountProvider({
  children,
  apiBaseUrl = '',
  secureAppUrl = DEFAULT_SECURE_APP_URL,
  onSignIn,
  onSignOut,
}: {
  children: ReactNode;
  apiBaseUrl?: string;
  secureAppUrl?: string;
  onSignIn?: () => void;
  onSignOut?: () => void;
}) {
  const [status, setStatus] = useState<AccountLoadStatus>('loading');
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [isStaticHost, setIsStaticHost] = useState(false);
  const [queueRuleEvent] = useState(() => {
    let queue = Promise.resolve();
    return <T,>(operation: () => Promise<T>) => {
      const pending = queue.then(operation);
      queue = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    };
  });
  const load = useCallback(
    async (showLoading = false, signal?: AbortSignal) => {
      const staticHost = isGitHubPagesHost();
      setIsStaticHost(staticHost);
      if (staticHost && !apiBaseUrl) {
        setAccount(null);
        setStatus('unavailable');
        setError(null);
        return null;
      }
      if (showLoading) setStatus('loading');
      try {
        const next = await getAccount(apiBaseUrl, signal);
        if (next.authenticated) {
          try {
            next.certification =
              (await getCertificationState(apiBaseUrl, signal)) ??
              next.certification;
          } catch (certificationError) {
            if (
              certificationError instanceof DOMException &&
              certificationError.name === 'AbortError'
            )
              return null;
            // Older deployments may not expose the state endpoint yet.
          }
        }
        setAccount(next);
        setStatus(next.authenticated ? 'authenticated' : 'guest');
        setError(null);
        return next.authenticated ? next : null;
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError')
          return null;
        if (caught instanceof AccountApiError && caught.status === 401) {
          setAccount(null);
          setStatus('guest');
          setError(null);
          return null;
        }
        setAccount(null);
        setStatus('unavailable');
        setError(
          caught instanceof Error
            ? caught.message
            : 'Account services are temporarily unavailable.',
        );
        return null;
      }
    },
    [apiBaseUrl],
  );

  useEffect(() => {
    const controller = new AbortController();
    const frame = requestAnimationFrame(() => {
      void load(true, controller.signal);
    });
    return () => {
      cancelAnimationFrame(frame);
      controller.abort();
    };
  }, [load]);

  const refresh = useCallback(() => load(false), [load]);

  const perform = useCallback(
    async <T,>(name: string, operation: () => Promise<T>) => {
      setBusyAction(name);
      setError(null);
      try {
        const result = await operation();
        await load(false);
        return result;
      } catch (caught) {
        const message =
          caught instanceof Error
            ? caught.message
            : 'The account action could not be completed.';
        setError(message);
        throw caught;
      } finally {
        setBusyAction(null);
      }
    },
    [load],
  );

  const updateProfile = useCallback(
    async (patch: AccountProfilePatch) => {
      await perform('profile', () => patchAccount(patch, apiBaseUrl));
    },
    [apiBaseUrl, perform],
  );
  const beginCertification = useCallback(async () => {
    await perform('start-certification', () => startCertification(apiBaseUrl));
  }, [apiBaseUrl, perform]);
  const resetCertification = useCallback(async () => {
    await perform('restart-certification', () =>
      restartCertification(apiBaseUrl),
    );
  }, [apiBaseUrl, perform]);
  const beginCertificationGame = useCallback(
    (payload: StartGamePayload) =>
      perform('start-game', () => startCertificationGame(payload, apiBaseUrl)),
    [apiBaseUrl, perform],
  );
  const completeCertificationGame = useCallback(
    async (attemptId: string, payload: FinishGamePayload) => {
      await perform('finish-game', () =>
        finishCertificationGame(attemptId, payload, apiBaseUrl),
      );
    },
    [apiBaseUrl, perform],
  );
  const recordRuleLearning = useCallback(
    async (event: RuleLearningEvent) => {
      if (status !== 'authenticated') return false;
      if (event.type === 'assistance') return true;
      return queueRuleEvent(async () => {
        await perform(
          event.mode === 'certification' ? 'rule-answer' : 'practice-rule',
          () => submitRuleLearningEvent(event, apiBaseUrl),
        );
        return true;
      });
    },
    [apiBaseUrl, perform, queueRuleEvent, status],
  );
  const [practiceAttemptIds] = useState(
    () => new Map<string, Promise<CertificationGameLaunch | null>>(),
  );
  const practiceTrackingBridge = useMemo<RefereePracticeTrackingBridge>(
    () => ({
      onStartSession: async (started) => {
        if (status !== 'authenticated') return;
        const launch = perform('start-practice-game', () =>
          startCertificationGame(
            {
              mode: started.mode,
              purpose: 'practice',
              clientSessionId: started.clientSessionId,
              seed: started.seed,
              durationSeconds: started.durationSeconds,
              topics: started.topics,
            },
            apiBaseUrl,
          ),
        ).catch(() => null);
        practiceAttemptIds.set(started.clientSessionId, launch);
        await launch;
      },
      onFinishSession: async (finished) => {
        if (status !== 'authenticated') return;
        const launch = await practiceAttemptIds.get(finished.clientSessionId);
        practiceAttemptIds.delete(finished.clientSessionId);
        if (!launch?.attemptId) return;
        try {
          await perform('finish-practice-game', () =>
            finishCertificationGame(
              launch.attemptId,
              {
                elapsedSeconds: finished.simulatedSeconds,
                correct: finished.report.correct,
                wrong: finished.report.wrong,
                missed: finished.report.missed,
                assisted: finished.report.assisted,
                accuracy: finished.report.accuracy,
                purpose: 'practice',
              },
              apiBaseUrl,
            ),
          );
        } catch {
          // Progress syncing must never interrupt an otherwise valid guest-style match.
        }
      },
    }),
    [apiBaseUrl, perform, practiceAttemptIds, status],
  );
  const practiceRuleLearningBridge = useMemo<RuleLearningBridge>(
    () => ({
      mode: 'practice',
      completedSituationIds: account?.practice.completedQuestionIds ?? [],
      onEvent: async (event) => {
        await recordRuleLearning(event);
      },
    }),
    [account?.practice.completedQuestionIds, recordRuleLearning],
  );
  const certificationRuleLearningBridge = useMemo<RuleLearningBridge>(
    () => ({
      mode: 'certification',
      certificationRunId: account?.certification?.id ?? null,
      completedSituationIds:
        account?.certification?.rules.answeredQuestionIds ?? [],
      onEvent: async (event) => {
        await recordRuleLearning(event);
      },
    }),
    [
      account?.certification?.id,
      account?.certification?.rules.answeredQuestionIds,
      recordRuleLearning,
    ],
  );

  const openSecureApp = useCallback(
    (page = 'profile') => {
      const destination = new URL(secureAppUrl);
      destination.searchParams.set('mode', 'academy');
      destination.searchParams.set('academy', page);
      if (typeof window !== 'undefined') {
        const locale = new URL(window.location.href).searchParams.get('lang');
        if (locale) destination.searchParams.set('lang', locale);
        window.location.assign(destination);
      }
    },
    [secureAppUrl],
  );

  const signIn = useCallback(() => {
    if (onSignIn) return onSignIn();
    if (isStaticHost) return openSecureApp('profile');
    const target = account?.links.signIn ?? '/signin-with-chatgpt';
    const url = new URL(target, window.location.origin);
    if (!url.searchParams.has('return_to'))
      url.searchParams.set('return_to', currentReturnTo('profile'));
    window.location.assign(url);
  }, [account?.links.signIn, isStaticHost, onSignIn, openSecureApp]);

  const signOut = useCallback(() => {
    if (onSignOut) return onSignOut();
    const target = account?.links.signOut ?? '/signout-with-chatgpt';
    const url = new URL(target, window.location.origin);
    if (!url.searchParams.has('return_to'))
      url.searchParams.set('return_to', '/');
    window.location.assign(url);
  }, [account?.links.signOut, onSignOut]);

  const value = useMemo<AccountContextValue>(
    () => ({
      status,
      account,
      error,
      busyAction,
      apiBaseUrl,
      secureAppUrl,
      isStaticHost,
      refresh,
      updateProfile,
      beginCertification,
      resetCertification,
      beginCertificationGame,
      completeCertificationGame,
      recordRuleLearning,
      practiceRuleLearningBridge,
      certificationRuleLearningBridge,
      practiceTrackingBridge,
      signIn,
      signOut,
      openSecureApp,
    }),
    [
      status,
      account,
      error,
      busyAction,
      apiBaseUrl,
      secureAppUrl,
      isStaticHost,
      refresh,
      updateProfile,
      beginCertification,
      resetCertification,
      beginCertificationGame,
      completeCertificationGame,
      recordRuleLearning,
      practiceRuleLearningBridge,
      certificationRuleLearningBridge,
      practiceTrackingBridge,
      signIn,
      signOut,
      openSecureApp,
    ],
  );

  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}

export function useAccount() {
  const value = useContext(AccountContext);
  if (!value)
    throw new Error('useAccount must be used inside an AccountProvider.');
  return value;
}
