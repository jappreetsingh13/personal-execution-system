import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TaskDraft } from '@/store/useTasksStore';
import { useTheme } from '@/theme/ThemeProvider';
import { speechModule } from '@/lib/speech';
import { parseTaskFromSpeech, type ParsedTask } from '@/lib/voiceTask';
import { formatRelativeDay, formatTime } from '@/lib/date';

type Phase = 'idle' | 'listening' | 'heard' | 'error';

/**
 * Speak a task, see it parsed, add it. The recognition events follow the Web
 * Speech API shape; `interimResults` gives a live transcript so the user can
 * tell the mic is actually picking them up.
 */
export function VoiceTaskSheet({
  visible,
  onClose,
  onAdd,
}: {
  visible: boolean;
  onClose: () => void;
  /** Called with a ready-to-save draft once the user confirms. */
  onAdd: (draft: TaskDraft, dateKey: string) => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  const [phase, setPhase] = useState<Phase>('idle');
  const [transcript, setTranscript] = useState('');
  const [parsed, setParsed] = useState<ParsedTask | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  /** Guard against double-firing the final result during the end sequence. */
  const gotFinal = useRef(false);
  /** Latest transcript, readable from listener closures without re-subscribing. */
  const transcriptRef = useRef('');

  // Reset when the sheet closes, so reopening starts a fresh listen.
  useEffect(() => {
    if (!visible) {
      setPhase('idle');
      setTranscript('');
      setParsed(null);
      setErrorMsg('');
      gotFinal.current = false;
    }
  }, [visible]);

  const startListening = async () => {
    const mod = speechModule();
    if (!mod) {
      setPhase('error');
      setErrorMsg('Speech recognition needs the installed app — it is not available here.');
      return;
    }

    gotFinal.current = false;
    transcriptRef.current = '';
    setTranscript('');
    setParsed(null);

    try {
      const perm = await mod.ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        setPhase('error');
        setErrorMsg('Microphone access is needed to hear you. Enable it in app settings.');
        return;
      }
      setPhase('listening');
      mod.ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
      });
    } catch (err) {
      console.warn('[voice] start failed', err);
      setPhase('error');
      setErrorMsg('Could not start listening on this device.');
    }
  };

  const stopListening = (advance: boolean) => {
    const mod = speechModule();
    mod?.ExpoSpeechRecognitionModule.stop();
    if (advance) {
      const text = transcriptRef.current.trim();
      if (text) {
        setParsed(parseTaskFromSpeech(text));
        setPhase('heard');
      } else {
        setPhase('idle');
      }
    }
  };

  useEffect(() => {
    if (!visible) return;
    const mod = speechModule();
    if (!mod) return;

    const finalize = (text: string) => {
      const clean = text.trim();
      if (!clean) return false;
      gotFinal.current = true;
      setTranscript(clean);
      setParsed(parseTaskFromSpeech(clean));
      setPhase('heard');
      return true;
    };

    const subs = [
      mod.ExpoSpeechRecognitionModule.addListener('result', (event) => {
        const text = event.results?.[0]?.transcript ?? '';
        if (!text) return;
        transcriptRef.current = text;
        setTranscript(text);
        // Android delivers a final result (confidence > 0) just before `end`;
        // iOS only signals finality through `end`. Parse as soon as it lands.
        if ((event.results?.[0]?.confidence ?? 0) > 0 && !gotFinal.current) {
          finalize(text);
        }
      }),
      mod.ExpoSpeechRecognitionModule.addListener('end', () => {
        if (gotFinal.current) return;
        finalize(transcriptRef.current);
        setPhase((cur) => (cur === 'listening' ? (transcriptRef.current.trim() ? 'heard' : 'idle') : cur));
      }),
      mod.ExpoSpeechRecognitionModule.addListener('error', (event) => {
        console.warn('[voice] error', event.error, event.message);
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        setPhase('error');
        setErrorMsg(
          event.error === 'not-allowed'
            ? 'Microphone access is needed to hear you. Enable it in app settings.'
            : 'Listening failed. Try saying it again.',
        );
      }),
    ];
    return () => {
      for (const s of subs) s.remove();
      // Leaving the sheet mid-listen must not leave the mic hot.
      try {
        speechModule()?.ExpoSpeechRecognitionModule.abort();
      } catch {
        // Already stopped.
      }
    };
  }, [visible]);

  const confirm = () => {
    if (!parsed?.title) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onAdd(
      {
        title: parsed.title,
        details: '',
        importance: 3,
        minutes: parsed.minutes ?? defaultMinutes(),
        recurrence: { kind: 'once' },
        startDate: parsed.dateKey,
        endDate: undefined,
        linkedNoteIds: [],
        sections: [],
        attachments: [],
        remindersEnabled: true,
        alarmEnabled: false,
      },
      parsed.dateKey,
    );
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: '#00000077', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: t.surface,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingTop: 8,
            paddingBottom: insets.bottom + 14,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: t.border,
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 38,
              height: 4,
              borderRadius: 2,
              backgroundColor: t.border,
              marginBottom: 12,
            }}
          />

          <Text style={{ color: t.text, fontSize: 16, fontWeight: '800', textAlign: 'center' }}>
            Add a task by voice
          </Text>
          <Text style={{ color: t.textDim, fontSize: 13, textAlign: 'center', marginTop: 3, paddingHorizontal: 24 }}>
            Say something like “Remind me to call the dentist tomorrow at 5 pm”
          </Text>

          {/* Mic */}
          <View style={{ alignItems: 'center', marginTop: 18, marginBottom: 14 }}>
            <Pressable
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                if (phase === 'listening') stopListening(true);
                else void startListening();
              }}
              style={({ pressed }) => ({
                width: 84,
                height: 84,
                borderRadius: 42,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: phase === 'listening' ? t.danger : t.accent,
                transform: [{ scale: pressed ? 0.94 : 1 }],
                elevation: 4,
                shadowColor: '#000',
                shadowOpacity: 0.2,
                shadowRadius: 6,
                shadowOffset: { width: 0, height: 3 },
              })}
              accessibilityLabel={phase === 'listening' ? 'Stop listening' : 'Start listening'}
            >
              <Ionicons name={phase === 'listening' ? 'stop' : 'mic'} size={34} color={t.onAccent} />
            </Pressable>
            <Text style={{ color: t.textDim, fontSize: 12.5, marginTop: 10, height: 16 }}>
              {phase === 'listening'
                ? 'Listening… tap to stop'
                : phase === 'heard'
                  ? 'Heard you — check it below'
                  : phase === 'error'
                    ? ''
                    : 'Tap the mic and speak'}
            </Text>
          </View>

          {transcript ? (
            <View
              style={{
                marginHorizontal: 18,
                padding: 13,
                borderRadius: 12,
                backgroundColor: t.surfaceAlt,
                gap: 8,
              }}
            >
              <Text style={{ color: t.text, fontSize: 15.5, lineHeight: 21 }}>
                “{transcript.trim()}”
              </Text>
              {parsed?.title ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                  <Chip text={parsed.title} icon="checkbox-outline" />
                  <Chip
                    text={parsed.minutes != null ? formatTime(parsed.minutes) : 'Next hour'}
                    icon="time-outline"
                  />
                  <Chip text={formatRelativeDay(parsed.dateKey)} icon="calendar-outline" />
                </View>
              ) : null}
            </View>
          ) : null}

          {phase === 'error' ? (
            <Text style={{ color: t.danger, fontSize: 13, textAlign: 'center', marginHorizontal: 24, marginTop: 10 }}>
              {errorMsg}
            </Text>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16, marginHorizontal: 18 }}>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 13,
                borderRadius: 12,
                alignItems: 'center',
                backgroundColor: t.surfaceAlt,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: t.textDim, fontSize: 15, fontWeight: '700' }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={confirm}
              disabled={!parsed?.title}
              style={({ pressed }) => ({
                flex: 2,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                paddingVertical: 13,
                borderRadius: 12,
                backgroundColor: t.accent,
                opacity: !parsed?.title ? 0.4 : pressed ? 0.75 : 1,
              })}
            >
              <Ionicons name="add-circle-outline" size={19} color={t.onAccent} />
              <Text style={{ color: t.onAccent, fontWeight: '800', fontSize: 15 }}>Add task</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function defaultMinutes(): number {
  const now = new Date();
  return Math.min(23 * 60 + 30, (now.getHours() + 1) * 60);
}

function Chip({ text, icon }: { text: string; icon: keyof typeof Ionicons.glyphMap }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: 8,
        backgroundColor: t.surface,
        borderWidth: 1,
        borderColor: t.border,
      }}
    >
      <Ionicons name={icon} size={12} color={t.accent} />
      <Text numberOfLines={1} style={{ color: t.text, fontSize: 12, fontWeight: '700', maxWidth: 220 }}>
        {text}
      </Text>
    </View>
  );
}
