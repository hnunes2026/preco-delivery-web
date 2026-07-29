'use strict';

/* =========================================================================
 * Preço Delivery — versão web
 * Porte fiel da lógica de domínio do app Android (Kotlin) para JavaScript,
 * incluindo a regra de negócio: o Investimento em Campanhas é sempre um
 * valor fixo em R$ e é descontado do preço final ANTES das demais taxas —
 * comissão, pagamento e (quando percentuais) anúncios/outras incidem sobre
 * o preço já líquido de campanhas.
 * ========================================================================= */

/* ---------- Money / parsing / formatting ---------- */

function round2(value) {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

const brlFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function formatBrl(value) {
  return brlFormatter.format(round2(value));
}

function formatPlainMoney(value) {
  return round2(value).toFixed(2).replace('.', ',');
}

/** Campos pequenos (percentuais, taxas fixas): vírgula é sempre separador decimal. */
function parseDecimalInput(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).trim().replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Preço de balcão: aceita ponto como separador de milhar e vírgula como decimal. */
function parseMoneyInput(raw) {
  if (raw == null) return null;
  let cleaned = String(raw).trim().replace(/R\$/g, '').replace(/\s/g, '');
  if ((cleaned.match(/,/g) || []).length > 1) return null;
  cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/* ---------- Domain enums ---------- */

const FeeType = { FIXED: 'FIXED', PERCENT: 'PERCENT' };
const FEE_TYPE_LABEL = { FIXED: 'Valor Fixo (R$)', PERCENT: 'Percentual (%)' };

const PriceRounding = { NONE: 'NONE', ENDING_90: 'ENDING_90', ENDING_99: 'ENDING_99', INTEGER: 'INTEGER' };
const ROUNDING_LABEL = { NONE: 'Nenhum', ENDING_90: 'Final ,90', ENDING_99: 'Final ,99', INTEGER: 'Inteiro' };
const ROUNDING_ORDER = [PriceRounding.NONE, PriceRounding.ENDING_90, PriceRounding.ENDING_99, PriceRounding.INTEGER];

const Platform = { IFOOD: 'IFOOD', NINETY_NINE_FOOD: 'NINETY_NINE_FOOD' };
const PLATFORM_LABEL = { IFOOD: 'iFood', NINETY_NINE_FOOD: '99Food' };

function defaultConfig() {
  return {
    commissionPercent: 0,
    paymentFeePercent: 0,
    fixedFee: 0,
    campaignAmount: 0,
    adsType: FeeType.PERCENT,
    adsValue: 0,
    otherFeesType: FeeType.PERCENT,
    otherFeesValue: 0,
    rounding: PriceRounding.NONE,
  };
}

/* ---------- PriceCalculator (porte de PriceCalculator.kt) ---------- */

function roundToEnding(price, ending) {
  const floorInt = Math.floor(price + 1e-9);
  let candidate = floorInt + ending;
  if (candidate < price - 1e-9) candidate += 1;
  return candidate;
}

function applyRounding(price, rounding) {
  switch (rounding) {
    case PriceRounding.INTEGER: return Math.ceil(price - 1e-9);
    case PriceRounding.ENDING_90: return roundToEnding(price, 0.9);
    case PriceRounding.ENDING_99: return roundToEnding(price, 0.99);
    default: return price;
  }
}

function resolveTargetNet(counterPrice, goal) {
  switch (goal.type) {
    case 'PLUS_FIXED': return counterPrice + goal.amount;
    case 'PLUS_PERCENT': return counterPrice * (1 + goal.percent / 100);
    default: return counterPrice;
  }
}

class FeeSumError extends Error {}

/** Recalcula os componentes de taxa a partir do preço final (já arredondado), para que o
 * breakdown exibido reconcilie exatamente com o valor líquido resultante. Todos os campos
 * configurados sempre aparecem no breakdown, mesmo quando o valor é zero. */
function buildResult(platform, counterPrice, finalPrice, config) {
  const campaign = round2(config.campaignAmount);
  const base = round2(finalPrice - campaign);
  const percentOfBase = (percent) => round2((base * percent) / 100);

  const commission = percentOfBase(config.commissionPercent);
  const payment = percentOfBase(config.paymentFeePercent);
  const ads = config.adsType === FeeType.PERCENT ? percentOfBase(config.adsValue) : round2(config.adsValue);
  const other = config.otherFeesType === FeeType.PERCENT ? percentOfBase(config.otherFeesValue) : round2(config.otherFeesValue);
  const fixedFee = round2(config.fixedFee);

  const totalFees = round2(campaign + commission + payment + ads + other + fixedFee);
  const netValue = round2(finalPrice - totalFees);
  const difference = round2(finalPrice - counterPrice);

  const breakdown = [
    { label: 'Preço Final', amount: finalPrice, isTotal: true },
    { label: 'Campanhas', amount: round2(-campaign) },
    { label: 'Comissão', amount: round2(-commission) },
    { label: 'Taxa de Pagamento', amount: round2(-payment) },
    { label: 'Anúncios', amount: round2(-ads) },
    { label: 'Outras Taxas', amount: round2(-other) },
    { label: 'Taxa Fixa por Pedido', amount: round2(-fixedFee) },
    { label: 'Valor Líquido', amount: netValue, isTotal: true },
  ];

  return {
    platform,
    suggestedPrice: finalPrice,
    netValue,
    totalFees,
    differenceFromCounter: difference,
    breakdown,
  };
}

function calculatePrice(platform, counterPrice, goal, config) {
  const targetNet = resolveTargetNet(counterPrice, goal);

  let pctBaseSum = config.commissionPercent + config.paymentFeePercent;
  let fixedFlat = config.fixedFee;
  if (config.adsType === FeeType.PERCENT) pctBaseSum += config.adsValue; else fixedFlat += config.adsValue;
  if (config.otherFeesType === FeeType.PERCENT) pctBaseSum += config.otherFeesValue; else fixedFlat += config.otherFeesValue;

  const pctBaseFraction = pctBaseSum / 100;
  if (pctBaseFraction >= 1) {
    throw new FeeSumError('A soma das taxas percentuais deve ser menor que 100%.');
  }

  const rawBase = (targetNet + fixedFlat) / (1 - pctBaseFraction);
  const rawPrice = rawBase + config.campaignAmount;
  const finalPrice = round2(applyRounding(rawPrice, config.rounding));

  return buildResult(platform, counterPrice, finalPrice, config);
}

/** Texto usado pelo botão "Copiar Cálculo": reproduz o mesmo passo a passo do modal de
 * Detalhes, do preço final até o valor líquido. */
function resultToDetailText(result) {
  const lines = [`Resultado ${PLATFORM_LABEL[result.platform]}`];
  result.breakdown.forEach((item) => lines.push(`${item.label}: ${formatBrl(item.amount)}`));
  return lines.join('\n');
}

/* ---------- Persistência (equivalente ao DataStore) ---------- */

const STORAGE_KEY = 'precoDeliverySettings.v1';

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ifood: defaultConfig(), ninetyNineFood: defaultConfig(), lastPlatform: Platform.IFOOD };
    const parsed = JSON.parse(raw);
    return {
      ifood: Object.assign(defaultConfig(), parsed.ifood),
      ninetyNineFood: Object.assign(defaultConfig(), parsed.ninetyNineFood),
      lastPlatform: parsed.lastPlatform === Platform.NINETY_NINE_FOOD ? Platform.NINETY_NINE_FOOD : Platform.IFOOD,
    };
  } catch (e) {
    return { ifood: defaultConfig(), ninetyNineFood: defaultConfig(), lastPlatform: Platform.IFOOD };
  }
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

let appSettings = loadSettings();

function configFor(platform) {
  return platform === Platform.IFOOD ? appSettings.ifood : appSettings.ninetyNineFood;
}

/* ---------- Estado da tela de calculadora ---------- */

const calcState = {
  goalType: 'MATCH_COUNTER',
  primaryPlatform: appSettings.lastPlatform,
  ifoodResult: null,
  ninetyNineFoodResult: null,
};

function resolveGoal() {
  const amountInput = document.getElementById('goalAmountInput');
  const percentInput = document.getElementById('goalPercentInput');
  switch (calcState.goalType) {
    case 'PLUS_FIXED': {
      const amount = parseDecimalInput(amountInput.value);
      return amount == null ? null : { type: 'PLUS_FIXED', amount };
    }
    case 'PLUS_PERCENT': {
      const percent = parseDecimalInput(percentInput.value);
      return percent == null ? null : { type: 'PLUS_PERCENT', percent };
    }
    default:
      return { type: 'MATCH_COUNTER' };
  }
}

function showCounterPriceError(message) {
  const errorEl = document.getElementById('counterPriceError');
  const input = document.getElementById('counterPriceInput');
  if (message) {
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
    input.classList.add('input-error');
  } else {
    errorEl.classList.add('hidden');
    input.classList.remove('input-error');
  }
}

function calculate() {
  const counterPriceInput = document.getElementById('counterPriceInput');
  const counterPrice = parseMoneyInput(counterPriceInput.value);

  if (counterPrice == null || counterPrice <= 0) {
    showCounterPriceError('Informe um preço de balcão válido.');
    calcState.ifoodResult = null;
    calcState.ninetyNineFoodResult = null;
    document.getElementById('resultsArea').classList.add('hidden');
    return;
  }

  const goal = resolveGoal();
  if (goal == null) {
    showCounterPriceError('Informe uma meta de recebimento válida.');
    return;
  }

  showCounterPriceError(null);

  try {
    calcState.ifoodResult = calculatePrice(Platform.IFOOD, counterPrice, goal, appSettings.ifood);
    calcState.ninetyNineFoodResult = calculatePrice(Platform.NINETY_NINE_FOOD, counterPrice, goal, appSettings.ninetyNineFood);
  } catch (e) {
    showCounterPriceError(e instanceof FeeSumError ? e.message : 'Não foi possível calcular com as taxas atuais.');
    return;
  }

  renderResults();
}

function recalculateIfPossible() {
  if (calcState.ifoodResult && calcState.ninetyNineFoodResult) calculate();
}

function renderResults() {
  const resultsArea = document.getElementById('resultsArea');
  const container = document.getElementById('resultCards');
  container.innerHTML = '';

  if (!calcState.ifoodResult || !calcState.ninetyNineFoodResult) {
    resultsArea.classList.add('hidden');
    return;
  }

  resultsArea.classList.remove('hidden');

  const ordered = calcState.primaryPlatform === Platform.IFOOD
    ? [calcState.ifoodResult, calcState.ninetyNineFoodResult]
    : [calcState.ninetyNineFoodResult, calcState.ifoodResult];

  ordered.forEach((result) => container.appendChild(renderResultCard(result)));
}

function renderResultCard(result) {
  const card = document.createElement('div');
  card.className = 'result-card';
  card.dataset.platform = result.platform;

  const diffSign = result.differenceFromCounter >= 0 ? '+' : '';

  card.innerHTML = `
    <h3>Resultado ${PLATFORM_LABEL[result.platform]}</h3>
    <div class="result-row emphasize">
      <span class="label">Preço ideal</span>
      <span class="value">${formatBrl(result.suggestedPrice)}</span>
    </div>
    <div class="result-row">
      <span class="label">Valor líquido recebido</span>
      <span class="value">${formatBrl(result.netValue)}</span>
    </div>
    <div class="result-row">
      <span class="label">Total de taxas</span>
      <span class="value">${formatBrl(result.totalFees)}</span>
    </div>
    <div class="result-row">
      <span class="label">Diferença para o balcão</span>
      <span class="value">${diffSign}${formatBrl(result.differenceFromCounter)}</span>
    </div>
    <div class="result-actions">
      <button class="text-btn" data-action="details" type="button">
        <svg><use href="#icon-info"/></svg><span>Detalhes</span>
      </button>
      <button class="text-btn" data-action="copy" type="button">
        <svg><use href="#icon-copy"/></svg><span>Copiar Cálculo</span>
      </button>
    </div>
  `;

  card.querySelector('[data-action="details"]').addEventListener('click', () => openDetailModal(result));
  card.querySelector('[data-action="copy"]').addEventListener('click', () => copyResultToClipboard(result));

  return card;
}

function openDetailModal(result) {
  document.getElementById('detailTitle').textContent = `Como chegamos nesse preço — ${PLATFORM_LABEL[result.platform]}`;
  const list = document.getElementById('detailList');
  list.innerHTML = '';

  result.breakdown.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'detail-row' + (item.isTotal ? ' total' : '');
    const isNegative = item.amount < 0;
    row.innerHTML = `
      <span class="label">${item.label}</span>
      <span class="value${isNegative ? ' negative' : ''}">${formatBrl(item.amount)}</span>
    `;
    list.appendChild(row);
  });

  document.getElementById('detailModal').classList.remove('hidden');
}

function closeDetailModal() {
  document.getElementById('detailModal').classList.add('hidden');
}

let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  toast.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.classList.add('hidden'), 200);
  }, 1800);
}

async function copyResultToClipboard(result) {
  const text = resultToDetailText(result);
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    showToast('Cálculo copiado!');
  } catch (e) {
    showToast('Não foi possível copiar.');
  }
}

function togglePrimaryPlatform() {
  calcState.primaryPlatform = calcState.primaryPlatform === Platform.IFOOD ? Platform.NINETY_NINE_FOOD : Platform.IFOOD;
  appSettings.lastPlatform = calcState.primaryPlatform;
  saveSettings(appSettings);
  renderResults();
}

function setGoalType(type) {
  calcState.goalType = type;
  document.querySelectorAll('#goalTypeChips .chip').forEach((chip) => {
    chip.classList.toggle('selected', chip.dataset.goal === type);
  });
  document.getElementById('goalAmountInput').classList.toggle('hidden', type !== 'PLUS_FIXED');
  document.getElementById('goalPercentInput').classList.toggle('hidden', type !== 'PLUS_PERCENT');
  recalculateIfPossible();
}

/* ---------- Tela de Configurações ---------- */

function renderPlatformSettings(containerId, platform, title) {
  const container = document.getElementById(containerId);
  const config = configFor(platform);

  container.innerHTML = `
    <h2>${title}</h2>
    <div class="field">
      <label class="field-label">Comissão (%)</label>
      <input type="text" inputmode="decimal" placeholder="0,00" data-field="commissionPercent" value="${settingsFieldValue(config.commissionPercent)}" />
    </div>
    <div class="field">
      <label class="field-label">Taxa de Pagamento (%)</label>
      <input type="text" inputmode="decimal" placeholder="0,00" data-field="paymentFeePercent" value="${settingsFieldValue(config.paymentFeePercent)}" />
    </div>
    <div class="field">
      <label class="field-label">Taxa Fixa por Pedido (R$)</label>
      <input type="text" inputmode="decimal" placeholder="0,00" data-field="fixedFee" value="${settingsFieldValue(config.fixedFee)}" />
    </div>
    <div class="field">
      <label class="field-label">Investimento em Campanhas (R$)</label>
      <input type="text" inputmode="decimal" placeholder="0,00" data-field="campaignAmount" value="${settingsFieldValue(config.campaignAmount)}" />
    </div>
    <div class="field">
      <label class="field-label">Investimento em Anúncios</label>
      <div class="chip-row" data-typed-field="ads">
        ${feeTypeChipsHtml(config.adsType)}
      </div>
      <input class="typed-fee-value" type="text" inputmode="decimal" data-field="adsValue"
        data-typed-input="ads" value="${settingsFieldValue(config.adsValue)}" />
    </div>
    <div class="field">
      <label class="field-label">Outras Taxas</label>
      <div class="chip-row" data-typed-field="other">
        ${feeTypeChipsHtml(config.otherFeesType)}
      </div>
      <input class="typed-fee-value" type="text" inputmode="decimal" data-field="otherFeesValue"
        data-typed-input="other" value="${settingsFieldValue(config.otherFeesValue)}" />
    </div>
    <div class="field">
      <label class="field-label">Arredondamento de preço</label>
      <div class="chip-row" data-rounding-field="rounding">
        ${roundingChipsHtml(config.rounding)}
      </div>
    </div>
  `;

  updateTypedValueLabel(container, 'ads', config.adsType);
  updateTypedValueLabel(container, 'other', config.otherFeesType);

  container.querySelectorAll('input[data-field]').forEach((input) => {
    input.addEventListener('input', () => {
      const field = input.dataset.field;
      const parsed = parseDecimalInput(input.value);
      updateConfig(platform, (cfg) => {
        cfg[field] = parsed == null ? 0 : parsed;
        return cfg;
      });
    });
  });

  container.querySelectorAll('[data-typed-field] .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const group = chip.closest('[data-typed-field]');
      const key = group.dataset.typedField;
      const feeType = chip.dataset.feeType;
      group.querySelectorAll('.chip').forEach((c) => c.classList.toggle('selected', c === chip));
      updateTypedValueLabel(container, key, feeType);
      updateConfig(platform, (cfg) => {
        cfg[key === 'ads' ? 'adsType' : 'otherFeesType'] = feeType;
        return cfg;
      });
    });
  });

  container.querySelectorAll('[data-rounding-field] .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const group = chip.closest('[data-rounding-field]');
      group.querySelectorAll('.chip').forEach((c) => c.classList.toggle('selected', c === chip));
      updateConfig(platform, (cfg) => {
        cfg.rounding = chip.dataset.rounding;
        return cfg;
      });
    });
  });
}

function feeTypeChipsHtml(selectedType) {
  return Object.values(FeeType)
    .map((type) => `<button class="chip${type === selectedType ? ' selected' : ''}" data-fee-type="${type}" type="button">${FEE_TYPE_LABEL[type]}</button>`)
    .join('');
}

function roundingChipsHtml(selectedRounding) {
  return ROUNDING_ORDER
    .map((r) => `<button class="chip${r === selectedRounding ? ' selected' : ''}" data-rounding="${r}" type="button">${ROUNDING_LABEL[r]}</button>`)
    .join('');
}

function updateTypedValueLabel(container, key, feeType) {
  const input = container.querySelector(`input[data-typed-input="${key}"]`);
  input.placeholder = '0,00';
}

/** Campo nunca configurado (valor 0) fica vazio, com "0,00" só como dica de formato —
 * evita mostrar números de exemplo já digitados nas Configurações. */
function settingsFieldValue(value) {
  return value === 0 ? '' : formatPlainMoney(value);
}

function updateConfig(platform, transform) {
  const key = platform === Platform.IFOOD ? 'ifood' : 'ninetyNineFood';
  appSettings[key] = transform(Object.assign({}, appSettings[key]));
  saveSettings(appSettings);
}

/* ---------- Navegação entre as 3 telas ---------- */

const VIEWS = ['calculator', 'settings', 'about'];
const VIEW_TITLES = { calculator: 'Preço Delivery-HNM', settings: 'Configurações', about: 'Sobre' };

function showView(name) {
  VIEWS.forEach((v) => {
    document.getElementById(`view-${v}`).classList.toggle('hidden', v !== name);
  });
  document.getElementById('topbarTitle').textContent = VIEW_TITLES[name];
  document.getElementById('calculatorActions').classList.toggle('hidden', name !== 'calculator');
  document.getElementById('btnBack').classList.toggle('hidden', name === 'calculator');

  if (name === 'settings') {
    renderPlatformSettings('settings-ifood', Platform.IFOOD, 'iFood');
    renderPlatformSettings('settings-99food', Platform.NINETY_NINE_FOOD, '99Food');
  }

  window.scrollTo(0, 0);
}

/* ---------- Inicialização ---------- */

function init() {
  document.getElementById('btnAbout').addEventListener('click', () => showView('about'));
  document.getElementById('btnSettings').addEventListener('click', () => showView('settings'));
  document.getElementById('btnBack').addEventListener('click', () => showView('calculator'));

  document.getElementById('counterPriceInput').addEventListener('input', () => showCounterPriceError(null));
  document.getElementById('btnCalculate').addEventListener('click', calculate);
  document.getElementById('goalAmountInput').addEventListener('input', recalculateIfPossible);
  document.getElementById('goalPercentInput').addEventListener('input', recalculateIfPossible);
  document.getElementById('btnSwapPlatform').addEventListener('click', togglePrimaryPlatform);

  document.querySelectorAll('#goalTypeChips .chip').forEach((chip) => {
    chip.addEventListener('click', () => setGoalType(chip.dataset.goal));
  });

  document.getElementById('btnCloseDetail').addEventListener('click', closeDetailModal);
  document.getElementById('detailModal').addEventListener('click', (event) => {
    if (event.target.id === 'detailModal') closeDetailModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDetailModal();
  });

  showView('calculator');
}

document.addEventListener('DOMContentLoaded', init);
