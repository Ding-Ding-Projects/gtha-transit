'use client';

import {
  CloudOff,
  Info,
  Mic2,
  SlidersHorizontal,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  supportsNarratorLanguage,
  type NarratorController,
  type NarratorSpokenLanguage,
  type NarratorVoice,
  type VoiceResolution,
} from '../lib/narrator';

type Translate = (en: string, zh: string) => string;

type VoicePickerProps = {
  controller: NarratorController;
  id: string;
  language: NarratorSpokenLanguage;
  label: string;
  resolution: VoiceResolution;
  setting: 'englishVoiceURI' | 'cantoneseVoiceURI';
  t: Translate;
};

function VoiceStatus({
  controller,
  language,
  resolution,
  t,
}: Omit<VoicePickerProps, 'id' | 'label' | 'setting'>) {
  if (!controller.speechAvailable)
    return (
      <output className="narrator-status" aria-live="polite">
        {t(
          'Browser speech synthesis is unavailable here. Your choices can still be saved, but this browser cannot speak them.',
          '呢個瀏覽器未能使用語音合成。設定仍可儲存，但此瀏覽器無法讀出內容。',
        )}
      </output>
    );
  if (!controller.voicesLoaded)
    return (
      <output className="narrator-status" aria-live="polite">
        {t(
          'Looking for voices installed in this browser…',
          '正在尋找此瀏覽器已安裝嘅語音…',
        )}
      </output>
    );
  if (resolution.missingSelection)
    return (
      <output className="narrator-status" aria-live="polite">
        {t(
          'Your selected voice is not installed on this device. The choice is kept, and the automatic voice is used when one is available.',
          '你揀咗嘅語音未安裝喺呢部裝置。設定會保留；如有可用語音，會自動使用。',
        )}
      </output>
    );
  if (!resolution.voice)
    return (
      <output className="narrator-status" aria-live="polite">
        {language === 'en'
          ? t(
              'No English voice is currently available on this device.',
              '此裝置暫時冇可用嘅英文語音。',
            )
          : t(
              'No Hong Kong Cantonese voice is currently available on this device.',
              '此裝置暫時冇可用嘅香港廣東話語音。',
            )}
      </output>
    );
  if (resolution.networkBacked)
    return (
      <output className="narrator-status" aria-live="polite">
        <CloudOff aria-hidden="true" size={16} />
        {t(
          'This voice may need a network connection and can be silent while offline.',
          '此語音可能需要網絡連線，離線時可能唔會讀出內容。',
        )}
      </output>
    );
  return (
    <output className="narrator-status" aria-live="polite">
      {t(
        'Using ' + resolution.voice.name + ' when narration is enabled.',
        '旁白開啟後會使用 ' + resolution.voice.name + '。',
      )}
    </output>
  );
}

function VoicePicker({
  controller,
  id,
  language,
  label,
  resolution,
  setting,
  t,
}: VoicePickerProps) {
  const matchingVoices = controller.voices.filter((voice) =>
    supportsNarratorLanguage(voice, language),
  );
  const selected = controller.settings[setting];
  const disabled = !controller.speechAvailable || !controller.settings.enabled;
  return (
    <fieldset className="narrator-voice-picker" disabled={disabled}>
      <legend>{label}</legend>
      <div
        className="narrator-voice-options"
        role="radiogroup"
        aria-label={label}
      >
        <label
          aria-label={t('Choose automatically', '自動選擇')}
          className="narrator-choice"
          htmlFor={id + '-automatic'}
        >
          <input
            id={id + '-automatic'}
            type="radio"
            name={id}
            value=""
            checked={selected === ''}
            onChange={() => controller.updateSettings({ [setting]: '' })}
          />
          <span>
            <strong>{t('Choose automatically', '自動選擇')}</strong>
            <small>
              {t(
                'Use the best available voice for this language.',
                '使用此語言最合適嘅可用語音。',
              )}
            </small>
          </span>
        </label>
        {matchingVoices.map((voice, index) => (
          <VoiceOption
            key={voice.voiceURI}
            id={id}
            index={index}
            selected={selected}
            setting={setting}
            controller={controller}
            t={t}
            voice={voice}
          />
        ))}
      </div>
      <VoiceStatus
        controller={controller}
        language={language}
        resolution={resolution}
        t={t}
      />
    </fieldset>
  );
}

function VoiceOption({
  controller,
  id,
  index,
  selected,
  setting,
  t,
  voice,
}: {
  controller: NarratorController;
  id: string;
  index: number;
  selected: string;
  setting: 'englishVoiceURI' | 'cantoneseVoiceURI';
  t: Translate;
  voice: NarratorVoice;
}) {
  return (
    <label
      aria-label={voice.name + ' ' + voice.lang}
      className="narrator-choice narrator-voice-choice"
      htmlFor={id + '-voice-' + index}
    >
      <input
        id={id + '-voice-' + index}
        type="radio"
        name={id}
        value={voice.voiceURI}
        checked={selected === voice.voiceURI}
        onChange={() => controller.updateSettings({ [setting]: voice.voiceURI })}
      />
      <span>
        <strong>{voice.name}</strong>
        <small>
          {voice.lang}
          {voice.localService ? '' : ' · ' + t('Network-backed', '需要網絡')}
        </small>
      </span>
    </label>
  );
}

export function NarratorSettings({
  narrator,
  t,
}: {
  narrator: NarratorController;
  t: Translate;
}) {
  const { settings } = narrator;
  const disabled = !narrator.speechAvailable || !settings.enabled;
  const voiceAvailable = settings.language === 'en' ? Boolean(narrator.englishVoice.voice) : settings.language === 'zh' ? Boolean(narrator.cantoneseVoice.voice) : Boolean(narrator.englishVoice.voice || narrator.cantoneseVoice.voice);
  return (
    <section
      className="narrator-card"
      aria-labelledby="narrator-settings-heading"
    >
      <div className="narrator-heading">
        <div className="narrator-heading-icon" aria-hidden="true">
          <Mic2 size={20} />
        </div>
        <div>
          <span className="eyebrow">{t('SPOKEN UPDATES', '語音提示')}</span>
          <h3 id="narrator-settings-heading">
            {t('Narrator', '旁白')}
          </h3>
        </div>
      </div>
      <p className="narrator-intro">
        {t(
          'Hear brief journey and saved-trip updates. Narration is off by default; its settings stay in this browser.',
          '可聽取簡短嘅行程同儲存提示。旁白預設關閉，設定只會留喺此瀏覽器。',
        )}
      </p>

      <label
        aria-label={t('Enable narration', '開啟旁白')}
        className="narrator-switch-row"
        htmlFor="narrator-enabled"
      >
        <input
          id="narrator-enabled"
          className="narrator-switch-input"
          type="checkbox"
          checked={settings.enabled}
          disabled={!narrator.speechAvailable}
          onChange={(event) =>
            narrator.updateSettings({ enabled: event.target.checked })
          }
        />
        <span className="narrator-switch-visual" aria-hidden="true" />
        <span>
          <strong>
            {settings.enabled
              ? t('Narration is on', '旁白已開啟')
              : t('Narration is off', '旁白已關閉')}
          </strong>
          <small>
            {t(
              'Turn it on only when spoken updates are useful to you.',
              '只喺你想聽提示時先開啟。',
            )}
          </small>
        </span>
      </label>

      {!narrator.speechAvailable && (
        <output className="narrator-alert" aria-live="polite">
          <VolumeX aria-hidden="true" size={18} />
          {t(
            'This browser does not provide speech synthesis, so narration cannot run here.',
            '此瀏覽器未提供語音合成，所以無法喺呢度使用旁白。',
          )}
        </output>
      )}
      {narrator.storageUnavailable && (
        <output className="narrator-alert" aria-live="polite">
          <Info aria-hidden="true" size={18} />
          {t(
            'This browser blocked local setting storage. Your narrator choices may reset after reload.',
            '此瀏覽器阻止本機儲存設定。重新載入後，旁白設定可能會重設。',
          )}
        </output>
      )}

      <details className="narrator-advanced">
      <summary>{t('Voice options & preview', '語音選項及試聽')}</summary>
      <fieldset className="narrator-language-picker" disabled={disabled}>
        <legend>{t('Narration language', '旁白語言')}</legend>
        <div
          className="narrator-language-options"
          role="radiogroup"
          aria-label={t('Narration language', '旁白語言')}
        >
          {[
            ['en', t('English', '英文')],
            ['zh', t('Hong Kong Cantonese', '香港廣東話')],
            ['both', t('Both, English then Cantonese', '兩種語言，先英文後廣東話')],
          ].map(([value, label]) => (
            <label
              className="narrator-choice"
              htmlFor={'narrator-language-' + value}
              key={value}
            >
              <input
                id={'narrator-language-' + value}
                type="radio"
                name="narrator-language"
                value={value}
                checked={settings.language === value}
                onChange={() =>
                  narrator.updateSettings({
                    language: value as 'en' | 'zh' | 'both',
                  })
                }
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <VoicePicker
        controller={narrator}
        id="narrator-english-voice"
        language="en"
        label={t('English voice', '英文語音')}
        resolution={narrator.englishVoice}
        setting="englishVoiceURI"
        t={t}
      />
      <VoicePicker
        controller={narrator}
        id="narrator-cantonese-voice"
        language="zh"
        label={t('Hong Kong Cantonese voice', '香港廣東話語音')}
        resolution={narrator.cantoneseVoice}
        setting="cantoneseVoiceURI"
        t={t}
      />

      <fieldset className="narrator-tuning" disabled={disabled}>
        <legend>
          <SlidersHorizontal aria-hidden="true" size={17} />
          {t('Voice tuning', '語音微調')}
        </legend>
        <label>
          <span>
            {t('Rate', '速度')} <output>{settings.rate.toFixed(1)}×</output>
          </span>
          <input
            type="range"
            min="0.1"
            max="10"
            step="0.1"
            value={settings.rate}
            onChange={(event) =>
              narrator.updateSettings({ rate: Number(event.target.value) })
            }
          />
        </label>
        <label>
          <span>
            {t('Pitch', '音調')} <output>{settings.pitch.toFixed(1)}</output>
          </span>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={settings.pitch}
            onChange={(event) =>
              narrator.updateSettings({ pitch: Number(event.target.value) })
            }
          />
        </label>
      </fieldset>

      <label
        aria-label={t('Quiet narration', '靜音旁白')}
        className="narrator-switch-row narrator-quiet-row"
        htmlFor="narrator-quiet"
      >
        <input
          id="narrator-quiet"
          className="narrator-switch-input"
          type="checkbox"
          checked={settings.quiet}
          disabled={!narrator.speechAvailable}
          onChange={(event) =>
            narrator.updateSettings({ quiet: event.target.checked })
          }
        />
        <span className="narrator-switch-visual" aria-hidden="true" />
        <span>
          <strong>{t('Quiet narration', '靜音旁白')}</strong>
          <small>
            {t(
              'Browsers cannot reliably detect a screen reader. Turn this on to silence the narrator while another voice is active.',
              '瀏覽器無法可靠地偵測螢幕閱讀器。當其他語音正在使用時，請開啟此選項令旁白靜音。',
            )}
          </small>
        </span>
      </label>

      <button type="button" className="pill" disabled={disabled || settings.quiet || !voiceAvailable} onClick={() => narrator.announce({ category: 'voice-preview', en: 'Your narrator is ready. Journey updates will be spoken in this voice.', zh: '旁白準備好喇，行程提示會用呢把聲讀出。', critical: true })}>
        {t('Preview narration', '試聽旁白')}
      </button>
      </details>
      <p className="narrator-privacy-note">
        <Volume2 aria-hidden="true" size={16} />
        {t(
          'The planner does not send narrator settings or speech text to its routing service. A network-backed browser voice may use its own voice service.',
          '規劃工具唔會將旁白設定或讀出內容傳送至路線服務。網絡語音可能使用瀏覽器自己嘅語音服務。',
        )}
      </p>
    </section>
  );
}

export default NarratorSettings;
