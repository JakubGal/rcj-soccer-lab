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
import type {
  AccountLoadStatus,
  AccountProfilePatch,
  AccountSnapshot,
  CertificationGameLaunch,
  FinishGamePayload,
  StartGamePayload,
} from '@/lib/account/types';
import type {
  MatchReplay,
  MatchReplayCheckpoint,
} from '@/lib/certification/replay';
import type {
  RefereePracticeTrackingBridge,
  RuleLearningBridge,
  RuleLearningEvent,
} from '@/lib/certification/client-types';
import {
  accountSnapshot,
  acceptGitHubReceipt,
  assertCanPrepareGitHubRequest,
  changeProgress,
  enableProfile,
  finishLocalGame,
  loadProgress,
  newRound,
  recordLocalRule,
  startLocalGame,
  resumeLocalGame,
  saveLocalCheckpoint,
  savedLocalReplay,
  trustedReceipt,
  updateLocalProfile,
  validateBackup,
  type LocalProgress,
} from '@/lib/account/local';
import {
  prepareSubmission,
  type GitHubReceipt,
  type PreparedSubmission,
} from '@/lib/github/protocol';
import { readReceipt } from '@/lib/github/registry';

export type AccountContextValue = {
  status: AccountLoadStatus;
  account: AccountSnapshot | null;
  error: string | null;
  busyAction: string | null;
  apiBaseUrl: string;
  isStaticHost: boolean;
  github: {
    request: PreparedSubmission | null;
    receipt: GitHubReceipt | null;
    connected: boolean;
  };
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
  resumeCertificationGame: (
    attemptId: string,
  ) => Promise<CertificationGameLaunch>;
  saveCertificationCheckpoint: (
    attemptId: string,
    checkpoint: MatchReplayCheckpoint,
  ) => Promise<void>;
  getGameReplay: (attemptId: string) => Promise<MatchReplay>;
  recordRuleLearning: (event: RuleLearningEvent) => Promise<boolean>;
  practiceRuleLearningBridge: RuleLearningBridge;
  certificationRuleLearningBridge: RuleLearningBridge;
  practiceTrackingBridge: RefereePracticeTrackingBridge;
  signIn: () => void;
  signOut: () => void;
  prepareGitHubSubmission: (kind: 'connect' | 'certify') => Promise<void>;
  checkGitHubSubmission: () => Promise<void>;
  exportProgress: () => void;
  importProgress: (file: File) => Promise<void>;
};
const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AccountLoadStatus>('loading');
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [github, setGithub] = useState<AccountContextValue['github']>({
    request: null,
    receipt: null,
    connected: false,
  });
  const applyData = useCallback(async (data: LocalProgress) => {
    const snapshot = await accountSnapshot(data);
    const receipt = await trustedReceipt(data.receipt);
    const connection = await trustedReceipt(data.connection);
    setAccount(snapshot);
    setStatus(snapshot.authenticated ? 'authenticated' : 'guest');
    setGithub({
      request: data.request,
      receipt,
      connected: connection?.status === 'accepted',
    });
    return snapshot;
  }, []);
  const refresh = useCallback(async () => {
    try {
      setError(null);
      return await applyData(await loadProgress());
    } catch (caught) {
      setStatus('unavailable');
      setError(
        caught instanceof Error
          ? caught.message
          : 'Progress could not be loaded.',
      );
      return null;
    }
  }, [applyData]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void refresh();
    });
    const channel =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel('rcj-academy');
    if (channel)
      channel.onmessage = () => {
        void refresh();
      };
    return () => {
      cancelAnimationFrame(frame);
      channel?.close();
    };
  }, [refresh]);
  const mutate = useCallback(
    async <T,>(
      name: string,
      operation: (data: LocalProgress) => T | Promise<T>,
    ) => {
      setBusyAction(name);
      setError(null);
      try {
        const { data, result } = await changeProgress(operation);
        await applyData(data);
        if (typeof BroadcastChannel !== 'undefined') {
          const channel = new BroadcastChannel('rcj-academy');
          channel.postMessage('updated');
          channel.close();
        }
        return result;
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'The profile action could not be completed.',
        );
        throw caught;
      } finally {
        setBusyAction(null);
      }
    },
    [applyData],
  );
  const signIn = useCallback(() => {
    void mutate('profile', enableProfile).catch(() => {});
  }, [mutate]);
  const signOut = useCallback(() => {
    void mutate('profile', (data) => {
      data.enabled = false;
    }).catch(() => {});
  }, [mutate]);
  const updateProfile = useCallback(
    async (patch: AccountProfilePatch) => {
      await mutate('profile', (data) => updateLocalProfile(data, patch));
    },
    [mutate],
  );
  const beginCertification = useCallback(async () => {
    await mutate('start-certification', (data) => {
      if (data.round)
        throw new Error('A certification round is already active.');
      return newRound(data);
    });
  }, [mutate]);
  const resetCertification = useCallback(async () => {
    await mutate('restart-certification', newRound);
  }, [mutate]);
  const beginCertificationGame = useCallback(
    (payload: StartGamePayload) =>
      mutate('start-game', (data) => startLocalGame(data, payload)),
    [mutate],
  );
  const completeCertificationGame = useCallback(
    async (id: string, payload: FinishGamePayload) => {
      await mutate('finish-game', (data) => finishLocalGame(data, id, payload));
    },
    [mutate],
  );
  const resumeCertificationGame = useCallback(
    async (id: string) => resumeLocalGame(await loadProgress(), id),
    [],
  );
  const getGameReplay = useCallback(
    async (id: string) => savedLocalReplay(await loadProgress(), id),
    [],
  );
  const saveCertificationCheckpoint = useCallback(
    async (id: string, checkpoint: MatchReplayCheckpoint) => {
      // Checkpoint writes share the same cross-tab transaction lock without
      // regrading every quiz answer or rerendering the entire Academy each time.
      await changeProgress((data) => saveLocalCheckpoint(data, id, checkpoint));
    },
    [],
  );
  const recordRuleLearning = useCallback(
    async (event: RuleLearningEvent) => {
      if (status !== 'authenticated') return false;
      await mutate(
        event.mode === 'certification' ? 'rule-answer' : 'practice-rule',
        (data) => recordLocalRule(data, event),
      );
      return true;
    },
    [mutate, status],
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
      certificationRunId:
        status === 'authenticated'
          ? (account?.certification?.id ?? null)
          : null,
      completedSituationIds:
        account?.certification?.rules.answeredQuestionIds ?? [],
      onEvent: async (event) => {
        await recordRuleLearning(event);
      },
    }),
    [status, account?.certification, recordRuleLearning],
  );
  const practiceTrackingBridge = useMemo<RefereePracticeTrackingBridge>(
    () => ({
      onFinishSession: async (game) => {
        if (status !== 'authenticated') return;
        try {
          await mutate('practice-game', (data) => {
            if (
              data.practiceGames.some(
                (entry) => entry.id === game.clientSessionId,
              )
            )
              return;
            data.practiceGames.push({
              id: game.clientSessionId,
              mode: game.mode,
              durationSeconds: game.simulatedSeconds,
              accuracy: game.report.accuracy,
              completedAt: new Date().toISOString(),
            });
          });
        } catch {
          /* Saving practice must not interrupt gameplay. The profile shows the storage error. */
        }
      },
    }),
    [status, mutate],
  );
  const prepareGitHubSubmission = useCallback(
    async (kind: 'connect' | 'certify') => {
      await mutate('github-submission', async (data) => {
        if (!data.enabled || !data.profile)
          throw new Error('Create a local profile first.');
        await assertCanPrepareGitHubRequest(data, kind);
        if (kind === 'certify') {
          const state = await accountSnapshot(data);
          if (state.certification?.status !== 'ready')
            throw new Error(
              'Complete all certification requirements before submitting.',
            );
        }
        const requestId = [...crypto.getRandomValues(new Uint8Array(16))]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
        data.request = await prepareSubmission({
          schema: 1,
          requestId,
          kind,
          profile: {
            displayName: data.profile.displayName,
            country: data.profile.country,
            publicProfile: data.profile.publicProfile,
          },
          ...(kind === 'certify' && data.round ? { round: data.round } : {}),
        });
        data.receipt = null;
      });
    },
    [mutate],
  );
  const checkGitHubSubmission = useCallback(async () => {
    const data = await loadProgress();
    if (!data.request)
      throw new Error('Prepare and submit a GitHub issue first.');
    const request = data.request;
    const result = await readReceipt(request.requestId);
    if (!result)
      throw new Error(
        'No signed result yet. Submit the GitHub issue, then check again in a few minutes.',
      );
    await mutate('github-check', async (current) => {
      if (current.request?.requestId !== request.requestId)
        throw new Error(
          'The pending submission has changed. Check the new request.',
        );
      await acceptGitHubReceipt(current, result.envelope);
    });
  }, [mutate]);
  const exportProgress = useCallback(() => {
    void loadProgress()
      .then((data) => {
        const blob = new Blob([JSON.stringify(data)], {
          type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'rcj-soccer-progress.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      })
      .catch((caught) =>
        setError(
          caught instanceof Error
            ? caught.message
            : 'Progress could not be exported.',
        ),
      );
  }, []);
  const importProgress = useCallback(
    async (file: File) => {
      if (file.size > 16 * 1024 * 1024)
        throw new Error('Progress backups must be smaller than 16 MB.');
      const incoming = await validateBackup(JSON.parse(await file.text()));
      await mutate('import-progress', (data) => {
        Object.assign(data, incoming);
      });
    },
    [mutate],
  );
  const value: AccountContextValue = {
    status,
    account,
    error,
    busyAction,
    apiBaseUrl: '',
    isStaticHost: true,
    github,
    refresh,
    updateProfile,
    beginCertification,
    resetCertification,
    beginCertificationGame,
    completeCertificationGame,
    resumeCertificationGame,
    saveCertificationCheckpoint,
    getGameReplay,
    recordRuleLearning,
    practiceRuleLearningBridge,
    certificationRuleLearningBridge,
    practiceTrackingBridge,
    signIn,
    signOut,
    prepareGitHubSubmission,
    checkGitHubSubmission,
    exportProgress,
    importProgress,
  };
  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}
export function useAccount() {
  const context = useContext(AccountContext);
  if (!context)
    throw new Error('useAccount must be used inside AccountProvider.');
  return context;
}
