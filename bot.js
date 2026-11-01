require("dotenv").config();
const { Bot, Keyboard, InlineKeyboard, InputFile } = require("grammy");
const mongoose = require("mongoose");
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");

const configCache = { data: {}, loaded: false, lastLoad: 0 };
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "10mb" }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use("/miniapp", express.static(path.join(__dirname, "public")));

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const MAIN_OWNER_ID = parseInt(process.env.ADMIN_ID || "8061612320", 10);

if (!BOT_TOKEN || !MONGO_URI) {
  console.error("❌ BOT_TOKEN & MONGO_URI required!");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);
const userState = {};
const CURRENT_LAYOUT_VERSION = "v2.0.0";

function toSmallCaps(text) {
  const map = {
    'a': 'ᴀ', 'b': 'ʙ', 'c': 'ᴄ', 'd': 'ᴅ', 'e': 'ᴇ', 'f': 'ꜰ', 'g': 'ɢ', 'h': 'ʜ', 'i': 'ɪ',
    'j': 'ᴊ', 'k': 'ᴋ', 'l': 'ʟ', 'm': 'ᴍ', 'n': 'ɴ', 'o': 'ᴏ', 'p': 'ᴘ', 'q': 'ǫ', 'r': 'ʀ',
    's': 'ꜱ', 't': 'ᴛ', 'u': 'ᴜ', 'v': 'ᴠ', 'w': 'ᴡ', 'x': 'x', 'y': 'ʏ', 'z': 'ᴢ'
  };
  return String(text).split('').map(c => map[c.toLowerCase()] || c).join('');
}

function toCapitalSmallCaps(text) {
  let str = String(text);
  let isFirst = true;
  return str.split('').map(c => {
    if (/[a-zA-Z]/.test(c)) {
      if (isFirst) { isFirst = false; return c.toUpperCase(); }
      return toSmallCaps(c);
    }
    return c;
  }).join('');
}

function applyFont(text, fontType = "normal") {
  if (!text) return text;
  switch (fontType) {
    case "smallcaps": return toSmallCaps(text);
    case "capital_smallcaps": return toCapitalSmallCaps(text);
    case "bold": return `<b>${text}</b>`;
    case "italic": return `<i>${text}</i>`;
    case "bold_italic": return `<b><i>${text}</i></b>`;
    case "monospace": return `<code>${text}</code>`;
    case "underline": return `<u>${text}</u>`;
    case "strike": return `<s>${text}</s>`;
    case "spoiler": return `<tg-spoiler>${text}</tg-spoiler>`;
    case "normal":
    default: return text;
  }
}

function entitiesToHtml(text, entities) {
  if (!entities || entities.length === 0) return String(text || "");
  let sorted = [...entities].sort((a, b) => b.offset - a.offset);
  let result = String(text);
  for (let ent of sorted) {
    let before = result.substring(0, ent.offset);
    let target = result.substring(ent.offset, ent.offset + ent.length);
    let after = result.substring(ent.offset + ent.length);
    let wrapped = target;
    switch (ent.type) {
      case "bold": wrapped = `<b>${target}</b>`; break;
      case "italic": wrapped = `<i>${target}</i>`; break;
      case "underline": wrapped = `<u>${target}</u>`; break;
      case "strikethrough": wrapped = `<s>${target}</s>`; break;
      case "spoiler": wrapped = `<tg-spoiler>${target}</tg-spoiler>`; break;
      case "code": wrapped = `<code>${target}</code>`; break;
      case "pre": wrapped = `<pre>${target}</pre>`; break;
      case "text_link": wrapped = `<a href="${ent.url}">${target}</a>`; break;
      case "blockquote": wrapped = `<blockquote>${target}</blockquote>`; break;
      case "text_mention":
        if (ent.user) wrapped = `<a href="tg://user?id=${ent.user.id}">${target}</a>`;
        break;
      case "custom_emoji":
        wrapped = `<tg-emoji emoji-id="${ent.custom_emoji_id}">${target}</tg-emoji>`;
        break;
      default: wrapped = target;
    }
    result = before + wrapped + after;
  }
  return result;
}

function formatDateTime(date) {
  const d = new Date(date);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const ist = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  let hours = ist.getHours();
  let ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12 || 12;
  return `${String(ist.getDate()).padStart(2,'0')} ${months[ist.getMonth()]} ${ist.getFullYear()}, ${String(hours).padStart(2,'0')}:${String(ist.getMinutes()).padStart(2,'0')}:${String(ist.getSeconds()).padStart(2,'0')} ${ampm}`;
}

function halfMaskUPI(upi) {
  if (!upi || upi === "Not Set") return upi;
  let str = String(upi).trim();
  let parts = str.split('@');
  if (parts.length !== 2) {
    if (str.length <= 4) return str.substring(0, 1) + '***';
    return str.substring(0, 3) + '***' + str.substring(str.length - 2);
  }
  let name = parts[0];
  let domain = parts[1];
  let maskedName = name.length <= 3 ? name.substring(0, 1) + '***' : name.substring(0, 3) + '***';
  return `${maskedName}@${domain}`;
}

function halfMaskBank(accNo) {
  if (!accNo || accNo === "Not Set") return accNo;
  let str = String(accNo).trim();
  if (str.length <= 6) return str.substring(0, 2) + '***';
  return str.substring(0, 4) + '***' + str.substring(str.length - 4);
}

function halfMaskWallet(wallet) {
  if (!wallet || wallet === "Not Set") return wallet;
  let str = String(wallet).trim();
  if (str.length <= 6) return str.substring(0, 2) + '***';
  return str.substring(0, 4) + '***' + str.substring(str.length - 4);
}

function halfMaskDetails(method, details) {
  if (method === "UPI" || method === "AUTO_UPI") return halfMaskUPI(details);
  if (method === "BANK" || method === "Bank") {
    let parts = String(details).split(',').map(s => s.trim());
    let maskedAcc = halfMaskBank(parts[0]);
    return maskedAcc + (parts[1] ? ` (${parts[1]})` : '');
  }
  if (method === "WALLET" || method === "Wallet") return halfMaskWallet(details);
  if (method === "AMAZON" || method === "Amazon") return halfMaskUPI(details);
  return halfMaskUPI(details);
}

function generateTxnNumber() {
  let num = '';
  for (let i = 0; i < 20; i++) num += Math.floor(Math.random() * 10);
  return num;
}

function convertOwnerLink(input) {
  let str = String(input || "").trim();
  if (str.startsWith('http://') || str.startsWith('https://')) return str;
  if (str.startsWith('tg://')) return str;
  if (str.startsWith('@')) return `https://t.me/${str.substring(1)}`;
  if (/^\d+$/.test(str)) return `tg://user?id=${str}`;
  return `https://t.me/${str}`;
}

function isValidTelegramID(input) {
  let str = String(input || "").trim();
  if (!str) return false;
  if (str.startsWith("https://t.me/")) return true;
  if (str.startsWith("tg://user?id=")) return true;
  if (/^\d+$/.test(str)) return true;
  let cleanUsername = str.replace(/^@/, '');
  if (/^[a-zA-Z0-9_]{5,32}$/.test(cleanUsername)) return true;
  return false;
}

function formatBalance(balance) {
  let num = Number(balance) || 0;
  if (num < 0) return `-₹${Math.abs(num).toFixed(2)}`;
  return `₹${num.toFixed(2)}`;
}

function makeProgressBar(percent) {
  let total = 20;
  let filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * total);
  return `[${"█".repeat(filled)}${"░".repeat(total - filled)}]`;
}

function formatTimeAgo(date) {
  let diff = Date.now() - new Date(date).getTime();
  let min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  let hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function parseInlineButtons(input) {
  if (!input || !input.trim()) return null;
  let lines = input.trim().split("\n").filter(l => l.trim() !== "");
  let rows = [];
  for (let line of lines) {
    let parts = line.trim().split("&&").map(p => p.trim()).filter(p => p !== "");
    let rowButtons = [];
    for (let part of parts) {
      let match = part.match(/^(.+?)\s*-\s*(https?:\/\/\S+)$/);
      if (match) rowButtons.push({ text: match[1].trim(), url: match[2].trim() });
    }
    if (rowButtons.length > 0) rows.push(rowButtons);
  }
  return rows.length > 0 ? rows : null;
}

function buildInlineKeyboardFromRows(rows) {
  if (!rows || rows.length === 0) return null;
  let kb = new InlineKeyboard();
  for (let row of rows) {
    for (let btn of row) {
      kb.url(btn.text, btn.url);
    }
    kb.row();
  }
  return kb;
}

function formatMinutes(min) {
  if (min < 60) return `${min} minutes`;
  if (min < 1440) return `${min / 60} hour(s)`;
  return `${min / 1440} day(s)`;
}

function buildProcessingDots(frame) {
  const dots = [
    "●  ○  ○",
    "●  ●  ○",
    "●  ●  ●",
    "○  ●  ●",
    "○  ○  ●"
  ];
  return dots[frame % dots.length];
}

function validateUPI(upi) {
  if (!upi) return false;
  let upiRegex = /^[a-zA-Z0-9._-]{2,}@[a-zA-Z0-9]{2,}$/;
  return upiRegex.test(String(upi).trim());
}

function validateWallet(wallet) {
  if (!wallet) return false;
  return /^\d{10,12}$/.test(String(wallet).trim());
}

function validateBankAcc(accNo) {
  if (!accNo) return false;
  return /^\d{9,18}$/.test(String(accNo).trim());
}

function validateIFSC(ifsc) {
  if (!ifsc) return false;
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(ifsc).trim().toUpperCase());
}
const userSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  firstName: { type: String, default: "" },
  lastName: { type: String, default: "" },
  username: { type: String, default: "" },
  balance: { type: Number, default: 0 },
  walletId: { type: String, default: "" },
  walletAccount: { type: String, default: "Not Set" },
  upiId: { type: String, default: "Not Set" },
  bankAccNo: { type: String, default: "Not Set" },
  bankIfsc: { type: String, default: "Not Set" },
  amazonEmail: { type: String, default: "Not Set" },
  redeemCodeAddr: { type: String, default: "Not Set" },
  gatewayNumbers: { type: Map, of: String, default: {} },
  walletNumber: { type: String, default: "" },
  depositApiUrl: { type: String, default: "" },
  joinedChannels: { type: [String], default: [] },
  withdrawnTotal: { type: Number, default: 0 },
  isBanned: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.models.User || mongoose.model("User", userSchema);

const userPreferenceSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  keyboardLayout: { type: Array, default: null },
  inlineMenus: { type: Object, default: {} },
  adminPanelLayout: { type: Array, default: null },
  fontPreference: { type: String, default: "normal" },
  updatedAt: { type: Date, default: Date.now }
});
const UserPreference = mongoose.models.UserPreference || mongoose.model("UserPreference", userPreferenceSchema);

const botAdminSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  addedAt: { type: Date, default: Date.now },
  addedBy: { type: Number, default: null },
  isActive: { type: Boolean, default: true },
  disabledAt: { type: Date, default: null },
  disabledBy: { type: Number, default: null }
});
const BotAdmin = mongoose.models.BotAdmin || mongoose.model("BotAdmin", botAdminSchema);

const taskSchema = new mongoose.Schema({
  taskId: { type: String, required: true, unique: true },
  title: { type: String, default: "" },
  reward: { type: Number, default: 0 },
  link: { type: String, default: "" },
  description: { type: String, default: "" },
  taskType: { type: String, default: "photo" },
  alertChannel: { type: String, default: "Not Set" },
  completedUsers: { type: [Number], default: [] },
  isActive: { type: Boolean, default: true },
  isComplete: { type: Boolean, default: false },
  expiryMinutes: { type: Number, default: 0 },
  expiresAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});
const Task = mongoose.models.Task || mongoose.model("Task", taskSchema);

const giftCodeSchema = new mongoose.Schema({
  code: { type: String, required: true },
  amount: { type: Number, required: true },
  type: { type: String, default: "redeem" },
  maxUses: { type: Number, default: 1 },
  usedUsers: { type: [Number], default: [] },
  createdAt: { type: Date, default: Date.now }
});
giftCodeSchema.index({ code: 1, type: 1 }, { unique: true });
const GiftCode = mongoose.models.GiftCode || mongoose.model("GiftCode", giftCodeSchema);

const taskSubmissionSchema = new mongoose.Schema({
  submissionId: { type: String, required: true, unique: true },
  userId: { type: Number, required: true },
  userName: { type: String, default: "" },
  taskId: { type: String, required: true },
  taskTitle: { type: String, required: true },
  reward: { type: Number, required: true },
  photoFileId: { type: String, required: true },
  status: { type: String, default: "Pending" },
  createdAt: { type: Date, default: Date.now }
});
const TaskSubmission = mongoose.models.TaskSubmission || mongoose.model("TaskSubmission", taskSubmissionSchema);

const withdrawalSchema = new mongoose.Schema({
  withdrawalId: { type: String, required: true, unique: true },
  userId: { type: Number, required: true },
  userWithdrawalCount: { type: Number, default: 1 },
  amount: { type: Number, required: true, min: 1 },
  method: { type: String, required: true },
  details: { type: String, required: true },
  status: { type: String, default: "Pending" },
  isGateway: { type: Boolean, default: false },
  gatewayName: { type: String, default: "" },
  gatewayResponse: { type: String, default: "" },
  txnNumber: { type: String, default: "" },
  taxPercent: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  netAmount: { type: Number, default: 0 },
  userMessageId: { type: Number, default: null },
  userChatId: { type: Number, default: null },
  approvedBy: { type: String, default: "" },
  approvedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});
const Withdrawal = mongoose.models.Withdrawal || mongoose.model("Withdrawal", withdrawalSchema);

const balanceHistorySchema = new mongoose.Schema({
  userId: { type: Number, required: true },
  action: { type: String, required: true },
  amount: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});
const BalanceHistory = mongoose.models.BalanceHistory || mongoose.model("BalanceHistory", balanceHistorySchema);

const adminLogSchema = new mongoose.Schema({
  adminId: { type: Number, required: true },
  adminName: { type: String, default: "" },
  action: { type: String, required: true },
  details: { type: String, default: "" },
  amount: { type: Number, default: 0 },
  targetUserId: { type: Number, default: null },
  createdAt: { type: Date, default: Date.now }
});
const AdminLog = mongoose.models.AdminLog || mongoose.model("AdminLog", adminLogSchema);

const upiPaymentSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  userId: { type: Number, required: true },
  amount: { type: Number, required: true },
  utr: { type: String, default: "" },
  upiId: { type: String, required: true },
  status: { type: String, default: "Pending" },
  source: { type: String, default: "bot" },
  verifiedAt: { type: Date, default: null },
  approvedBy: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now }
});
const UPIPayment = mongoose.models.UPIPayment || mongoose.model("UPIPayment", upiPaymentSchema);

const channelSchema = new mongoose.Schema({
  channelId: { type: String, required: true, unique: true },
  inviteLink: { type: String, required: true },
  displayName: { type: String, default: "" },
  isActive: { type: Boolean, default: true },
  isHidden: { type: Boolean, default: false },
  order: { type: Number, default: 0 },
  addedAt: { type: Date, default: Date.now }
});
const Channel = mongoose.models.Channel || mongoose.model("Channel", channelSchema);

const socialLinkSchema = new mongoose.Schema({
  name: { type: String, required: true },
  link: { type: String, required: true },
  addedAt: { type: Date, default: Date.now }
});
const SocialLink = mongoose.models.SocialLink || mongoose.model("SocialLink", socialLinkSchema);

const configSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed }
});
const Config = mongoose.models.Config || mongoose.model("Config", configSchema);

const gatewaySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  url: { type: String, required: true },
  url_template: { type: String, default: "" },
  isActive: { type: Boolean, default: true },
  minAmount: { type: Number, default: 0 },
  maxAmount: { type: Number, default: 0 },
  taxPercent: { type: Number, default: 0 },
  createdBy: { type: Number, default: null },
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});
const Gateway = mongoose.models.Gateway || mongoose.model("Gateway", gatewaySchema);

const autoUpiSchema = new mongoose.Schema({
  gatewayId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  apiUrl: { type: String, required: true },
  method: { type: String, default: "GET" },
  status: { type: String, default: "active" },
  minAmount: { type: Number, default: 0 },
  maxAmount: { type: Number, default: 0 },
  taxPercent: { type: Number, default: 0 },
  order: { type: Number, default: 0 },
  createdBy: { type: Number, default: null },
  createdAt: { type: Date, default: Date.now }
});
const AutoUpi = mongoose.models.AutoUpi || mongoose.model("AutoUpi", autoUpiSchema);

const autoBankSchema = new mongoose.Schema({
  gatewayId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  apiUrl: { type: String, required: true },
  method: { type: String, default: "GET" },
  status: { type: String, default: "active" },
  minAmount: { type: Number, default: 0 },
  maxAmount: { type: Number, default: 0 },
  taxPercent: { type: Number, default: 0 },
  order: { type: Number, default: 0 },
  createdBy: { type: Number, default: null },
  createdAt: { type: Date, default: Date.now }
});
const AutoBank = mongoose.models.AutoBank || mongoose.model("AutoBank", autoBankSchema);

const withdrawSettingsSchema = new mongoose.Schema({
  method: { type: String, required: true, unique: true },
  isActive: { type: Boolean, default: true },
  minAmount: { type: Number, default: 0 },
  maxAmount: { type: Number, default: 0 },
  taxPercent: { type: Number, default: 0 },
  maxCount: { type: Number, default: 0 },
  cooldownMinutes: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now }
});
const WithdrawSettings = mongoose.models.WithdrawSettings || mongoose.model("WithdrawSettings", withdrawSettingsSchema);

const liveFundSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: "main_fund" },
  totalFund: { type: Number, default: 0 },
  usedFund: { type: Number, default: 0 },
  isActive: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now }
});
const LiveFund = mongoose.models.LiveFund || mongoose.model("LiveFund", liveFundSchema);

const broadcastSchema = new mongoose.Schema({
  broadcastId: { type: String, required: true, unique: true },
  adminId: { type: Number, required: true },
  adminName: { type: String, default: "" },
  messageType: { type: String, default: "text" },
  content: { type: String, default: "" },
  fileId: { type: String, default: "" },
  sentCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  totalCount: { type: Number, default: 0 },
  timeTaken: { type: Number, default: 0 },
  status: { type: String, default: "Pending" },
  createdAt: { type: Date, default: Date.now }
});
const Broadcast = mongoose.models.Broadcast || mongoose.model("Broadcast", broadcastSchema);

const newUserLogSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  firstName: { type: String, default: "" },
  username: { type: String, default: "" },
  startTime: { type: Date, default: Date.now }
});
const NewUserLog = mongoose.models.NewUserLog || mongoose.model("NewUserLog", newUserLogSchema);

const bugLogSchema = new mongoose.Schema({
  userId: { type: Number, default: 0 },
  firstName: { type: String, default: "Unknown" },
  errorMessage: { type: String, required: true },
  errorStack: { type: String, default: "" },
  action: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now }
});
const BugLog = mongoose.models.BugLog || mongoose.model("BugLog", bugLogSchema);
const DEFAULT_KEYBOARD_LAYOUT = [
  { name: `📋 ${toCapitalSmallCaps("Bot Task")}`, key: "btn_tasks", row: 0, hidden: false },
  { name: `💸 ${toCapitalSmallCaps("My Balance")}`, key: "btn_balance", row: 0, hidden: false },
  { name: `🎁 ${toCapitalSmallCaps("Gift Code")}`, key: "btn_gift", row: 1, hidden: false },
  { name: `⚡ ${toCapitalSmallCaps("Quick Pay")}`, key: "btn_quickpay", row: 1, hidden: false },
  { name: `💳 ${toCapitalSmallCaps("Payout Method")}`, key: "btn_payout", row: 2, hidden: false },
  { name: `🚀 ${toCapitalSmallCaps("Withdraw")}`, key: "btn_withdraw", row: 2, hidden: false }
];

const DEFAULT_ADMIN_PANEL_LAYOUT = [
  { name: `👮 ${toCapitalSmallCaps("Add/Remove Admins")}`, key: "adm_permissions", row: 0, hidden: false },
  { name: `👑 ${toCapitalSmallCaps("Transfer Ownership")}`, key: "adm_transfer", row: 1, hidden: false },
  { name: `💰 ${toCapitalSmallCaps("Set Withdraw Tax")}`, key: "adm_set_wd_tax", row: 1, hidden: false },
  { name: `👮 ${toCapitalSmallCaps("Manage Admins")}`, key: "adm_admins", row: 2, hidden: false },
  { name: `🚫 ${toCapitalSmallCaps("Manage Ban Users")}`, key: "adm_manage_ban", row: 2, hidden: false },
  { name: `🤖 ${toCapitalSmallCaps("Bot Status")}`, key: "adm_bot_status", row: 3, hidden: false },
  { name: `🚫 ${toCapitalSmallCaps("Manage Ban Wallet")}`, key: "adm_manage_ban_wallet", row: 3, hidden: false },
  { name: `💸 ${toCapitalSmallCaps("Withdraw Status")}`, key: "adm_wd_status", row: 4, hidden: false },
  { name: `➕ ${toCapitalSmallCaps("Add Balance")}`, key: "adm_add_bal", row: 4, hidden: false },
  { name: `➖ ${toCapitalSmallCaps("Remove Balance")}`, key: "adm_rem_bal", row: 5, hidden: false },
  { name: `⚡ ${toCapitalSmallCaps("Manage Your Channels")}`, key: "adm_manage_channels", row: 5, hidden: false },
  { name: `⚠️ ${toCapitalSmallCaps("Reset Balance")}`, key: "adm_reset_all_bal", row: 6, hidden: false },
  { name: `🎨 ${toCapitalSmallCaps("Customize Your Theme")}`, key: "adm_customize_theme", row: 6, hidden: false },
  { name: `💬 ${toCapitalSmallCaps("Talk With User")}`, key: "adm_talk_user", row: 7, hidden: false },
  { name: `📢 ${toCapitalSmallCaps("Broadcast")}`, key: "adm_broadcast", row: 7, hidden: false },
  { name: `🔍 ${toCapitalSmallCaps("Find User Details")}`, key: "adm_find_user", row: 8, hidden: false },
  { name: `📊 ${toCapitalSmallCaps("Status")}`, key: "adm_status", row: 8, hidden: false },
  { name: `⚡ ${toCapitalSmallCaps("Quick Pay")}`, key: "adm_quick_pay", row: 9, hidden: false },
  { name: `🚀 ${toCapitalSmallCaps("Withdrawal Step")}`, key: "adm_gateway_menu", row: 9, hidden: false },
  { name: `🎁 ${toCapitalSmallCaps("Manage Redeem Codes")}`, key: "adm_redeem", row: 10, hidden: false },
  { name: `🔔 ${toCapitalSmallCaps("New User Notification")}`, key: "adm_user_notif", row: 11, hidden: false },
  { name: `📋 ${toCapitalSmallCaps("Manage Tasks")}`, key: "adm_tasks_manager", row: 12, hidden: false },
  { name: `🚀 ${toCapitalSmallCaps("Recent Admin Actions")}`, key: "adm_recent_actions", row: 13, hidden: false },
  { name: `🔄 ${toCapitalSmallCaps("Refresh Panel")}`, key: "admin", row: 13, hidden: false }
];

const DEFAULT_BALANCE_TEXT = {
  welcome: `⭐ ${toCapitalSmallCaps("Welcome To Bot!")}`,
  footer: `❝ ${toCapitalSmallCaps("Built with security you can Trust.")}\n${toCapitalSmallCaps("Support that responds promptly")} ❞`
};

const DEFAULT_START_TEXT = {
  title: `💫 ${toCapitalSmallCaps("Welcome To Task Payment Bot!")}`,
  linkPrefix: `${toCapitalSmallCaps("How To Earn")} → `,
  linkClickable: `${toCapitalSmallCaps("Click Here")}`
};

const FONT_OPTIONS = [
  { key: "normal", name: "Normal", preview: "Admin Panel" },
  { key: "capital_smallcaps", name: "Capital Small Caps", preview: "Aᴅᴍɪɴ Pᴀɴᴇʟ" }
];

async function preloadAllConfigs() {
  try {
    let allConfigs = await Config.find({}).lean();
    let newData = {};
    for (let conf of allConfigs) {
      newData[conf.key] = conf.value;
    }
    configCache.data = newData;
    configCache.loaded = true;
    configCache.lastLoad = Date.now();
    console.log(`⚡ Configs preloaded: ${allConfigs.length} keys`);
  } catch (e) {
    console.error("Config preload error:", e.message);
  }
}

async function getConfig(key, defaultValue) {
  if (configCache.data[key] !== undefined) {
    return configCache.data[key];
  }
  let conf = await Config.findOne({ key }).lean();
  let value = conf ? conf.value : defaultValue;
  configCache.data[key] = value;
  return value;
}

async function setConfig(key, value) {
  configCache.data[key] = value;
  await Config.findOneAndUpdate({ key }, { value }, { upsert: true });
}

async function isAdmin(userId) {
  try {
    if (Number(userId) === Number(MAIN_OWNER_ID)) return true;
    let ownerId = configCache.data["owner_id"] ?? await getConfig("owner_id", MAIN_OWNER_ID);
    if (Number(userId) === Number(ownerId)) return true;
    let botAdmin = await BotAdmin.findOne({ userId, isActive: true }).lean();
    if (botAdmin) return true;
    return false;
  } catch (e) { return false; }
}

async function isAdminDisabled(userId) {
  try {
    let botAdmin = await BotAdmin.findOne({ userId, isActive: false }).lean();
    return !!botAdmin;
  } catch (e) { return false; }
}

async function isOwner(userId) {
  let ownerId = configCache.data["owner_id"] ?? await getConfig("owner_id", MAIN_OWNER_ID);
  return Number(userId) === Number(ownerId) || Number(userId) === Number(MAIN_OWNER_ID);
}

async function isWhitelisted(userId) {
  try {
    let whitelist = await getConfig("quick_pay_whitelist", []);
    if (!Array.isArray(whitelist)) return false;
    return whitelist.map(Number).includes(Number(userId));
  } catch (e) { return false; }
}

async function getUser(userId) {
  return await User.findOneAndUpdate(
    { userId },
    { $setOnInsert: { walletId: userId.toString() } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function checkForceJoin(ctx) {
  let forceJoinEnabled = await getConfig("force_join_enabled", true);
  if (!forceJoinEnabled) return true;

  let userId = ctx.from.id;

  let isOwnerUser = await isOwner(userId);
  let isAdminUser = await isAdmin(userId);
  if (isOwnerUser || isAdminUser) return true;

  let channels = await Channel.find({ isActive: true, isHidden: { $ne: true } }).lean();
  if (!channels || channels.length === 0) return true;

  let bannedAllowed = await getConfig("banned_in_channel_allowed", true);
  let joinedChannels = [];

  let results = await Promise.allSettled(
    channels.map(ch =>
      ctx.api.getChatMember(ch.channelId, userId)
        .then(m => ({ ch, status: m.status }))
        .catch(() => ({ ch, status: "error" }))
    )
  );

  for (let r of results) {
    if (r.status !== "fulfilled") continue;
    let { ch, status } = r.value;
    if (status === "kicked") {
      if (bannedAllowed) continue;
      return false;
    }
    if (["left", "restricted"].includes(status)) {
      return false;
    }
    if (["member", "administrator", "creator"].includes(status)) {
      joinedChannels.push(ch.channelId);
    }
  }

  if (joinedChannels.length > 0) {
    await User.updateOne({ userId }, { joinedChannels });
  }

  return true;
}

async function getPayoutChannel(method = null) {
  let newCh = await getConfig("payout_channel", null);
  if (newCh && newCh !== "Not Set") return newCh;

  if (method) {
    let oldCh = await getConfig("payout_channel_" + method.toLowerCase(), null);
    if (oldCh && oldCh !== "Not Set") return oldCh;
  }

  for (let m of ["upi", "wallet"]) {
    let oldCh = await getConfig("payout_channel_" + m, null);
    if (oldCh && oldCh !== "Not Set") return oldCh;
  }

  return "Not Set";
}

async function logBalanceHistory(userId, action, amount) {
  try {
    await BalanceHistory.create({ userId, action, amount });
  } catch (e) {
    console.error("logBalanceHistory:", e.message);
  }
}

async function logAdminAction(adminId, adminName, action, details = "", amount = 0, targetUserId = null) {
  try {
    await AdminLog.create({ adminId, adminName, action, details, amount, targetUserId });
  } catch (e) {
    console.error("logAdminAction:", e.message);
  }
}

async function calculateTax(amount) {
    let rules = await getConfig("tax_rules", []);
    if (!Array.isArray(rules)) return { tax: 0, net: amount };

    for (let rule of rules) {
        if (amount >= rule.min && amount <= rule.max) {
            let tax = rule.tax;
            let net = amount - tax;
            if (net < 0) net = 0;
            return { tax, net };
        }
    }
    return { tax: 0, net: amount };
}
async function buildKeyboardFromLayout(userId) {
  let userPref = await UserPreference.findOne({ userId }).lean();
  let layout;

  if (userPref && userPref.keyboardLayout && userPref.keyboardLayout.length > 0) {
    layout = userPref.keyboardLayout;
  } else {
    let freshConfig = await Config.findOne({ key: "keyboard_layout" }).lean();
    layout = (freshConfig && freshConfig.value) ? freshConfig.value : DEFAULT_KEYBOARD_LAYOUT;
    configCache.data["keyboard_layout"] = layout;
  }

  let keyboardRows = [];
  let maxRow = layout.length > 0 ? Math.max(...layout.map(b => b.row)) : 0;
  for (let r = 0; r <= maxRow; r++) {
    let rowButtons = layout.filter(b => b.row === r && !b.hidden);
    if (rowButtons.length > 0) {
      let row = rowButtons.map(btn => ({ text: btn.name }));
      keyboardRows.push(row);
    }
  }
  if (keyboardRows.length === 0) {
    keyboardRows = [[{ text: `💸 ${toCapitalSmallCaps("My Balance")}` }]];
  }
  return {
    keyboard: keyboardRows,
    resize_keyboard: true,
    is_persistent: false,
    one_time_keyboard: false
  };
}

async function getCurrentKeyboardLayoutForUser(userId) {
  let userPref = await UserPreference.findOne({ userId }).lean();
  if (userPref && userPref.keyboardLayout && userPref.keyboardLayout.length > 0) {
    return userPref.keyboardLayout;
  }
  return configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
}

async function saveUserKeyboard(userId, layout) {
  await UserPreference.findOneAndUpdate(
    { userId },
    { keyboardLayout: layout, updatedAt: new Date() },
    { upsert: true }
  );
}

async function buildStyledKb(buttons) {
  return { inline_keyboard: buttons };
}

async function getActiveKeyboardLayout() {
  let layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  return layout.filter(b => !b.hidden);
}

async function getActiveAdminPanelLayout() {
  let layout = configCache.data["admin_panel_layout"] || DEFAULT_ADMIN_PANEL_LAYOUT;
  return layout.filter(b => !b.hidden);
}

async function getUserFont(userId) {
  let pref = await UserPreference.findOne({ userId }).lean();
  return (pref && pref.fontPreference) ? pref.fontPreference : "normal";
}

async function sendUnknownCommand(ctx) {
  try {
    let active = await getConfig("unknown_command_active", false);
    if (!active) return;
    let text = await getConfig("unknown_command_text", "❓ I didn't understand that.\n\nPlease /start the bot again.");
    let plainText = String(text).replace(/<[^>]*>/g, "");
    return ctx.reply(plainText, {
      link_preview_options: { is_disabled: true }
    }).catch(() => { });
  } catch (e) { }
}

async function animateProcessing(ctx, messageId, chatId, durationMs = 30000) {
  let frame = 0;
  const startTime = Date.now();
  const interval = setInterval(async () => {
    if (Date.now() - startTime > durationMs) {
      clearInterval(interval);
      return;
    }
    try {
      await bot.api.editMessageText(chatId, messageId,
        `⏳ ${toCapitalSmallCaps("Processing")} ${buildProcessingDots(frame)}`,
        { parse_mode: "HTML" }
      );
    } catch (e) { }
    frame++;
  }, 400);
  return interval;
}

async function processGatewayPayout({ bot, userId, amount, gatewayInfo, wallet, channelList = [], showRemainingBalance = true }) {
  try {
    let urlTemplate = gatewayInfo.url_template || gatewayInfo.url || "";
    
    let finalUrl = urlTemplate
      .replace(/{number}/g, encodeURIComponent(wallet)) 
      .replace(/{wallet}/g, encodeURIComponent(wallet)) 
      .replace(/{amount}/g, amount) 
      .replace(/{comment}/g, encodeURIComponent("WD" + Date.now()))
      .replace(/{userId}/g, encodeURIComponent(userId))
      .replace(/{orderId}/g, encodeURIComponent("WD" + Date.now()))
      .replace(/{txnId}/g, encodeURIComponent("TXN" + Date.now()))
      .replace(/{timestamp}/g, encodeURIComponent(Date.now()));

    let response;
    let resData;
    try {
      response = await axios.get(finalUrl, { timeout: 30000 });
      try { resData = JSON.stringify(response.data); }
      catch (e) { resData = String(response.data); }
    } catch (apiErr) {
      return { status: 'error', message: apiErr.message || 'Gateway request failed' };
    }

    let isSuccess = false;
    let txnNumber = null;
    try {
      let data = response.data;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { } }
      if (data && typeof data === 'object') {
        isSuccess =
          data.status === 'success' || data.status === 'Success' ||
          data.status === 'SUCCESS' || data.success === true ||
          data.status === 'ok' || data.status === 'OK' ||
          data.result === 'ok' || data.result === 'success' ||
          data.code === 200 || data.code === '200';
        txnNumber = data.txn_id || data.txnNumber || data.transaction_id || data.txnId || null;
      }
      if (!isSuccess && resData && /success|completed|done|paid/i.test(resData)) isSuccess = true;
    } catch (parseErr) { }

    if (!isSuccess) {
      return { status: 'failed', message: 'Gateway declined the transaction', rawResponse: resData ? resData.substring(0, 300) : '' };
    }

    let user = await User.findOne({ userId });
    if (!user) return { status: 'error', message: 'User not found' };

    let newBalance = user.balance;
    let botUsername = bot.botInfo ? bot.botInfo.username : "Bot";

    let maskedWallet = halfMaskWallet(wallet);

    let msg = `✅ <b>New Wallet Withdrawal</b> ✅\n\n` +
              `<b>User :</b> <a href="tg://user?id=${userId}"><b>${userId}</b></a>\n`;
    if (showRemainingBalance) msg += `<b>Remaining Balance :-</b> <code><b>₹${newBalance.toFixed(2)}</b></code>\n\n`;
    msg += `<b>Amount :</b> <code><b>₹${amount.toFixed(2)}</b></code> INR (-)\n` +
           `<b>Address :</b> <code>${maskedWallet}</code>\n` +
           `<b>Payment Ref :</b> <code><b>${txnNumber || 'N/A'}</b></code>\n\n` +
           `<b>Bot:</b> @${botUsername}\n\n` +
           `⚠️ <b>${gatewayInfo.name} Response:</b>\n<code>${resData}</code>`;

    for (let ch of channelList) {
      if (!ch) continue;
      try { await bot.api.sendMessage(ch, msg, { parse_mode: "HTML" }).catch(() => { }); }
      catch (channelErr) { }
    }

    return { status: 'success', txnNumber: txnNumber || generateTxnNumber(), rawResponse: resData };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

async function processAutoUpiPayout({ bot, userId, amount, gateway, upiId }) {
  try {
    let ref = "AUTO" + Date.now();
    let separator = gateway.apiUrl.includes("?") ? "&" : "?";
    let finalUrl = `${gateway.apiUrl}${separator}upi=${encodeURIComponent(upiId)}&amount=${amount}&ref=${ref}&userId=${userId}&timestamp=${Date.now()}`;

    let response;
    let resData;
    try {
      response = await axios({
        method: gateway.method || "GET",
        url: finalUrl,
        timeout: 30000
      });
      try { resData = JSON.stringify(response.data); }
      catch (e) { resData = String(response.data); }
    } catch (apiErr) {
      return { status: 'error', message: apiErr.message || 'Auto UPI request failed' };
    }

    let isSuccess = false;
    let txnId = null;
    try {
      let data = response.data;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { } }
      if (data && typeof data === 'object') {
        isSuccess =
          data.status === 'success' || data.status === 'Success' ||
          data.status === 'SUCCESS' || data.success === true ||
          data.status === 'ok' || data.status === 'OK' ||
          data.code === 200 || data.code === '200';
        txnId = data.txn_id || data.transaction_id || data.txnId || null;
      }
      if (!isSuccess && resData && /success|completed|done|paid/i.test(resData)) isSuccess = true;
    } catch (parseErr) { }

    if (!isSuccess) {
      return { status: 'failed', message: 'Auto UPI declined', rawResponse: resData ? resData.substring(0, 300) : '' };
    }

    let user = await User.findOne({ userId });
    if (!user) return { status: 'error', message: 'User not found' };

    let newBalance = user.balance;
    let botUsername = bot.botInfo ? bot.botInfo.username : "Bot";
    let maskedUPI = halfMaskUPI(upiId);

    let msg = `✅ <b>New Auto UPI Withdrawal</b> ✅\n\n` +
              `<b>User :</b> <a href="tg://user?id=${userId}"><b>${userId}</b></a>\n` +
              `<b>Remaining Balance :-</b> <code><b>₹${newBalance.toFixed(2)}</b></code>\n\n` +
              `<b>Amount :</b> <code><b>₹${amount.toFixed(2)}</b></code> INR (-)\n` +
              `<b>Address :</b> <code>${maskedUPI}</code>\n` +
              `<b>Payment Ref :</b> <code><b>${txnId || 'N/A'}</b></code>\n\n` +
              `<b>Bot:</b> @${botUsername}\n\n` +
              `⚠️ <b>${gateway.name} Response:</b>\n<code>${resData}</code>`;

    let payoutChannel = await getPayoutChannel("auto_upi");
    if (payoutChannel && payoutChannel !== "Not Set") {
      try { await bot.api.sendMessage(payoutChannel, msg, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
    }

    return { status: 'success', txnNumber: txnId || generateTxnNumber(), rawResponse: resData };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}
app.get("/receipt/:id", async (req, res) => {
  try {
    let wd = await Withdrawal.findOne({ withdrawalId: req.params.id });
    if (!wd) return res.status(404).send("<h2 style='color:white;background:#111;text-align:center;padding:50px;'>Receipt not found!</h2>");

    let ownerId = await getConfig("owner_id", MAIN_OWNER_ID);
    let ownerName = await getConfig("owner_display_name", null);
    let ownerLink = await getConfig("owner_display_link", null);
    if (!ownerName) {
      let ownerUser = await User.findOne({ userId: ownerId });
      ownerName = ownerUser ? (ownerUser.firstName || "Owner") : "Owner";
    }
    if (!ownerLink) ownerLink = ownerId.toString();
    let finalOwnerLink = convertOwnerLink(ownerLink);

    let isSuccess = wd.status === "Approved";
    let isFailed = wd.status === "Rejected" || wd.status === "Failed";
    let statusTitle = isSuccess ? "TRANSFER COMPLETE" : (isFailed ? "TRANSFER FAILED" : "TRANSFER PENDING");
    let statusSubtitle = isSuccess ? "FUNDS CREDITED" : (isFailed ? "TRANSACTION REJECTED" : "PROCESSING PAYMENT");
    let accentColor = isSuccess ? "#00ffcc" : (isFailed ? "#ff4d4d" : "#ffa500");
    let iconSvg = isSuccess ? "&#10003;" : (isFailed ? "&#10005;" : "&#8943;");

    let dateLabel = isSuccess ? "APPROVED ON" : (isFailed ? "REJECTED ON" : "SUBMITTED ON");
    let displayDate = (isSuccess || isFailed) && wd.approvedAt ? new Date(wd.approvedAt) : new Date(wd.createdAt);

    let displayTxn = wd.txnNumber && wd.txnNumber !== "" ? wd.txnNumber : wd.withdrawalId;
    let gatewayDisplay = wd.gatewayName && wd.gatewayName !== "" ? wd.gatewayName : (wd.isGateway ? "GATEWAY" : "MANUAL");
    let approvedBy = wd.approvedBy && wd.approvedBy !== "" ? wd.approvedBy : "-";

    let safeAmount = wd.amount.toFixed(2);
    let safeDetails = escapeHtml(wd.details).replace(/'/g, "\\'");
    let safeTxn = escapeHtml(displayTxn).replace(/'/g, "\\'");

    let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Receipt #${escapeHtml(wd.withdrawalId)}</title>
    <style>
      body{background:#0b0e14;color:#fff;font-family:'Segoe UI',sans-serif;margin:0;padding:20px;display:flex;align-items:center;justify-content:center;min-height:100vh;}
      .container{background:#151a21;border-radius:20px;padding:30px;max-width:420px;width:100%;text-align:center;border:1px solid #222c37;}
      .icon-box{width:70px;height:70px;background:rgba(0,255,204,0.1);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:32px;color:${accentColor};border:2px solid ${accentColor};}
      .title{font-size:20px;font-weight:bold;color:${accentColor};letter-spacing:1px;}
      .subtitle{font-size:12px;color:#8a9ba8;margin:5px 0 25px;}
      .card-box{background:#1e2530;border-radius:15px;padding:20px;margin-bottom:20px;}
      .amount-label{font-size:11px;color:#8a9ba8;text-transform:uppercase;}
      .amount-val{font-size:32px;font-weight:bold;margin-top:8px;cursor:pointer;user-select:all;}
      .info-row{background:#151a21;border-radius:10px;padding:12px 15px;margin-top:10px;display:flex;justify-content:space-between;font-size:13px;gap:10px;}
      .info-title{color:#8a9ba8;flex-shrink:0;}
      .info-value{color:#fff;font-weight:500;text-align:right;word-break:break-all;cursor:pointer;user-select:all;}
      .info-value.mono{font-family:'Courier New',monospace;color:#00ffcc;font-size:12px;}
      .status-badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:600;margin-top:5px;}
      .status-pending{background:rgba(255,165,0,0.15);color:#ffa500;border:1px solid #ffa500;}
      .status-approved{background:rgba(0,255,204,0.15);color:#00ffcc;border:1px solid #00ffcc;}
      .status-rejected,.status-failed{background:rgba(255,77,77,0.15);color:#ff4d4d;border:1px solid #ff4d4d;}
      .close-btn{background:#2a3443;color:#fff;border:none;width:100%;padding:14px;border-radius:12px;font-size:14px;font-weight:bold;cursor:pointer;margin-top:15px;}
      .provider-footer{margin-top:22px;padding-top:18px;border-top:1px solid #222c37;text-align:center;}
      .provider-text{font-size:13px;color:#8a9ba8;}
      .provider-name{color:#00ffcc;font-weight:700;text-decoration:none;border-bottom:1px dashed #00ffcc;padding-bottom:2px;}
    </style></head><body>
    <div class="container">
      <div class="icon-box">${iconSvg}</div>
      <div class="title">${statusTitle}</div>
      <div class="subtitle">${statusSubtitle}</div>
      <div class="card-box"><div class="amount-label">WITHDRAWAL AMOUNT</div><div class="amount-val" data-copy="${safeAmount}">₹ ${safeAmount}</div></div>
      <div class="info-row"><span class="info-title">METHOD</span><span class="info-value">${escapeHtml(wd.method.toUpperCase())}</span></div>
      <div class="info-row"><span class="info-title">DESTINATION</span><span class="info-value" data-copy="${safeDetails}">${escapeHtml(wd.details)}</span></div>
      <div class="info-row"><span class="info-title">TXN ID</span><span class="info-value mono" data-copy="${safeTxn}">${escapeHtml(displayTxn)}</span></div>
      <div class="info-row"><span class="info-title">REF NO</span><span class="info-value mono">TXN${escapeHtml(wd.withdrawalId)}</span></div>
      <div class="info-row"><span class="info-title">GATEWAY</span><span class="info-value">${escapeHtml(gatewayDisplay)}</span></div>
      <div class="info-row"><span class="info-title">APPROVED BY</span><span class="info-value">${escapeHtml(approvedBy)}</span></div>
      <div class="info-row"><span class="info-title">${dateLabel}</span><span class="info-value">${displayDate.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}</span></div>
      <div style="margin-top:15px;"><span class="status-badge status-${wd.status.toLowerCase()}">${wd.status.toUpperCase()}</span></div>
      <button class="close-btn" onclick="window.close()">CLOSE & RETURN</button>
      <div class="provider-footer">
        <div class="provider-text">Provided by <a href="${finalOwnerLink}" class="provider-name" target="_blank">${escapeHtml(ownerName)}</a></div>
      </div>
    </div>
    <script>
      document.querySelectorAll('[data-copy]').forEach(el => {
        el.addEventListener('click', () => {
          navigator.clipboard.writeText(el.dataset.copy).then(() => {
            let t = document.createElement('div');
            t.textContent = '✅ Copied!';
            t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#00ffcc;color:#000;padding:10px 20px;border-radius:10px;font-weight:bold;z-index:9999;';
            document.body.appendChild(t);
            setTimeout(() => t.remove(), 1500);
          });
        });
      });
    </script>
    </body></html>`;
    res.send(html);
  } catch (e) { res.status(500).send("Error"); }
});

app.get("/", (req, res) => res.send("Bot Server Live!"));
app.get("/health", (req, res) => res.json({ status: "ok", uptime: process.uptime() }));

app.get("/miniapp", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/miniapp/withdraw", (req, res) => res.sendFile(path.join(__dirname, "public", "withdraw.html")));
app.get("/miniapp/task", (req, res) => res.sendFile(path.join(__dirname, "public", "task.html")));
app.get("/miniapp/pay", (req, res) => res.sendFile(path.join(__dirname, "public", "pay.html")));
app.get("/miniapp/profile", (req, res) => res.sendFile(path.join(__dirname, "public", "profile.html")));
app.get("/miniapp/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/miniapp/history", (req, res) => res.sendFile(path.join(__dirname, "public", "history.html")));

app.get("/miniapp/api/user/:userId", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const user = await User.findOne({ userId }).lean();
    if (!user) return res.json({ success: false, error: "User not found" });
    let linkedInfo = "Not Linked";
    if (user.walletNumber && user.walletNumber !== "") linkedInfo = `Wallet: ${user.walletNumber}`;
    else if (user.upiId && user.upiId !== "Not Set") linkedInfo = `UPI: ${user.upiId}`;
    else if (user.bankAccNo && user.bankAccNo !== "Not Set") linkedInfo = `Bank: ${user.bankAccNo}`;
    let gwNumbers = {};
    if (user.gatewayNumbers) {
      if (user.gatewayNumbers instanceof Map) gwNumbers = Object.fromEntries(user.gatewayNumbers);
      else if (typeof user.gatewayNumbers === "object") gwNumbers = { ...user.gatewayNumbers };
    }
    res.json({ success: true, user: { ...user, linkedInfo, gatewayNumbers: gwNumbers } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/profile-photo/:userId", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    let photos = await bot.api.getUserProfilePhotos(userId, { limit: 1 });
    if (photos.total_count === 0) return res.json({ success: false });
    res.json({ success: true, photoUrl: `/miniapp/api/photo-proxy/${userId}` });
  } catch (e) { res.json({ success: false }); }
});

app.get("/miniapp/api/photo-proxy/:userId", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    let photos = await bot.api.getUserProfilePhotos(userId, { limit: 1 });
    if (photos.total_count === 0) return res.status(404).end();
    let fileId = photos.photos[0][0].file_id;
    let file = await bot.api.getFile(fileId);
    let url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    let response = await axios.get(url, { responseType: 'stream' });
    res.setHeader('Content-Type', response.headers['content-type']);
    response.data.pipe(res);
  } catch (e) { res.status(500).end(); }
});

app.get("/miniapp/api/is-admin/:userId", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    res.json({ success: true, isAdmin: await isAdmin(userId), isOwner: await isOwner(userId) });
  } catch (e) { res.json({ success: false, isAdmin: false }); }
});

app.get("/miniapp/api/config", async (req, res) => {
  try {
    const config = {
      appLogo: await getConfig("app_logo", "Task Earn Bot"),
      botUsername: await getConfig("bot_username", ""),
      minWithdraw: await getConfig("min_withdraw", 10),
      maxWithdraw: await getConfig("max_withdraw", 10000),
      supportUsername: await getConfig("support_username", "Not Set"),
      ownerId: await getConfig("owner_id", MAIN_OWNER_ID),
      ownerDisplayName: await getConfig("owner_display_name", null),
      ownerDisplayLink: await getConfig("owner_display_link", null)
    };
    res.json({ success: true, config });
  } catch (e) { res.json({ success: false, error: e.message }); }
});
app.get("/miniapp/api/tasks", async (req, res) => {
  try {
    const tasks = await Task.find({ isActive: { $ne: false }, isComplete: true }).lean();
    res.json({ success: true, tasks });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/total-balance", async (req, res) => {
  try {
    const users = await User.find({}).lean();
    const totalBalance = users.reduce((s, u) => s + (u.balance || 0), 0);
    res.json({ success: true, totalBalance, totalUsers: users.length });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/check-user/:userId", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const user = await User.findOne({ userId }).lean();
    if (!user) return res.json({ success: false, error: "User not found" });
    let photoUrl = null;
    try {
      let photos = await bot.api.getUserProfilePhotos(userId, { limit: 1 });
      if (photos.total_count > 0) photoUrl = `/miniapp/api/photo-proxy/${userId}`;
    } catch (e) { }
    res.json({ success: true, user: { userId: user.userId, firstName: user.firstName, username: user.username, balance: user.balance, photoUrl } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/gateways", async (req, res) => {
  try {
    const gateways = await Gateway.find({ isActive: true }).lean();
    res.json({ success: true, gateways });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/auto-upi", async (req, res) => {
  try {
    const gateways = await AutoUpi.find({ status: "active" }).sort({ order: 1, createdAt: 1 }).lean();
    res.json({ success: true, gateways });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/gateway/save-number", async (req, res) => {
  try {
    const { userId, number } = req.body;
    const uid = parseInt(userId, 10);
    if (!uid || !number) return res.json({ success: false, error: "Missing fields" });
    let user = await getUser(uid);
    user.walletNumber = String(number).trim();
    await user.save();
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/gateway/withdraw", async (req, res) => {
  try {
    const { userId, gatewayName, amount } = req.body;
    const uid = parseInt(userId, 10);
    const amt = parseFloat(amount);
    if (!uid || !gatewayName || isNaN(amt) || amt <= 0) return res.json({ success: false, error: "Invalid data" });
    const gateway = await Gateway.findOne({ name: gatewayName, isActive: true });
    if (!gateway) return res.json({ success: false, error: "Gateway not found or inactive" });
    let user = await User.findOne({ userId: uid });
    if (!user) return res.json({ success: false, error: "User not found" });
    let wallet = user.walletNumber || "";
    if (!wallet) return res.json({ success: false, error: "Please save your number first", needsNumber: true });
    let minW = gateway.minAmount || 0;
    let maxW = gateway.maxAmount || 0;
    if (minW > 0 && amt < minW) return res.json({ success: false, error: `Min ₹${minW}` });
    if (maxW > 0 && amt > maxW) return res.json({ success: false, error: `Max ₹${maxW}` });
    if (user.balance < amt) return res.json({ success: false, error: "Insufficient balance" });

    let taxPercent = gateway.taxPercent || 0;
    let taxAmount = taxPercent > 0 ? (amt * taxPercent) / 100 : 0;
    let netAmount = amt - taxAmount;

    user.balance -= amt;
    user.withdrawnTotal = (user.withdrawnTotal || 0) + amt;
    await user.save();
    await logBalanceHistory(uid, `Withdrawn via ${gatewayName} (MiniApp)`, -amt);

    if (taxAmount > 0) {
      const ownerId = await getConfig("owner_id", MAIN_OWNER_ID);
      await User.findOneAndUpdate({ userId: ownerId }, { $inc: { balance: taxAmount } });
      await logBalanceHistory(ownerId, `Withdrawal Tax (${gatewayName})`, taxAmount);
    }

    let payoutChannel = await getPayoutChannel(gatewayName);
    let channelList = payoutChannel && payoutChannel !== "Not Set" ? [payoutChannel] : [];
    let approvedCount = await Withdrawal.countDocuments({ userId: uid, status: "Approved" });
    let userWithdrawalCount = approvedCount + 1;
    let withdrawalId = Math.floor(100000 + Math.random() * 900000).toString();
    let result = await processGatewayPayout({ bot, userId: uid, amount: netAmount, gatewayInfo: gateway, wallet, channelList, showRemainingBalance: true });

    if (result.status === 'success') {
      let txnNumber = result.txnNumber || generateTxnNumber();
      let processTime = new Date();
      await Withdrawal.create({
        withdrawalId, userId: uid, userWithdrawalCount, amount: amt,
        method: gatewayName, details: wallet, status: "Approved",
        isGateway: true, gatewayName: gateway.name,
        gatewayResponse: result.rawResponse || "",
        txnNumber, taxPercent, taxAmount, netAmount: netAmount,
        approvedBy: "Auto Gateway", approvedAt: processTime
      });
      await LiveFund.findOneAndUpdate({ key: "main_fund" }, { $inc: { usedFund: amt } }, { upsert: true });
      let serverUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
      if (!serverUrl.startsWith("http")) serverUrl = `https://${serverUrl}`;
      let receiptUrl = `${serverUrl}/receipt/${withdrawalId}`;
      try {
        await bot.api.sendMessage(uid,
          `🎁Your Withdrawal of Rs.<code>${amt.toFixed(2)}</code> is Successfully Processed!🔥🔥\n\n` +
          `🏦 Destination ==> <code>${halfMaskWallet(wallet)}</code>\n` +
          `🚀 Transaction ID ==> <code>${txnNumber}</code>\n\n` +
          `✅Please Check Your ${gateway.name} Account!`,
          { parse_mode: "HTML", reply_markup: new InlineKeyboard().url("✅ Check Status", receiptUrl) }).catch(() => { });
      } catch (e) { }
      return res.json({ success: true, autoProcessed: true, withdrawalId, txnNumber });
    } else {
      user.balance += amt;
      user.withdrawnTotal = Math.max(0, (user.withdrawnTotal || 0) - amt);
      await user.save();
      await logBalanceHistory(uid, `Withdrawal Failed (Refunded)`, amt);
      return res.json({ success: false, error: result.message || "Gateway failed" });
    }
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/withdraw", async (req, res) => {
  try {
    const { userId, amount, method } = req.body;
    const uid = parseInt(userId, 10);
    const amt = parseFloat(amount);
    const user = await User.findOne({ userId: uid });
    if (!user) return res.json({ success: false, error: "User not found" });
    let withdrawEnabled = await getConfig("withdraw_enabled", true);
    if (!withdrawEnabled) return res.json({ success: false, error: "Withdrawals disabled" });
    let methodSetting = await WithdrawSettings.findOne({ method: method.toLowerCase() });
    if (methodSetting && !methodSetting.isActive) return res.json({ success: false, error: `${method} is currently OFF` });
    let details = "";
    if (method === "UPI") details = user.upiId;
    else if (method === "Bank") details = (user.bankAccNo && user.bankAccNo !== "Not Set") ? `${user.bankAccNo}, ${user.bankIfsc}` : "";
    else return res.json({ success: false, error: "Invalid method" });
    if (!details || details === "Not Set" || details.trim() === "" || details.includes("Not Set")) return res.json({ success: false, error: `${method} not linked!`, needsLink: true, method });
    let minW = methodSetting ? methodSetting.minAmount : 0;
    let maxW = methodSetting ? methodSetting.maxAmount : 0;
    if (minW > 0 && amt < minW) return res.json({ success: false, error: `Min ₹${minW}` });
    if (maxW > 0 && amt > maxW) return res.json({ success: false, error: `Max ₹${maxW}` });
    if (user.balance < amt) return res.json({ success: false, error: "Insufficient balance" });

    let { tax: taxAmount, net: netAmount } = await calculateTax(amt);

    user.balance -= amt;
    user.withdrawnTotal = (user.withdrawnTotal || 0) + amt;
    await user.save();
    await logBalanceHistory(uid, `Withdrawn via ${method} (MiniApp)`, -amt);

    if (taxAmount > 0) {
      const ownerId = await getConfig("owner_id", MAIN_OWNER_ID);
      await User.findOneAndUpdate({ userId: ownerId }, { $inc: { balance: taxAmount } });
      await logBalanceHistory(ownerId, `Withdrawal Tax (${method})`, taxAmount);
    }

    let approvedCount = await Withdrawal.countDocuments({ userId: uid, status: "Approved" });
    let userWithdrawalCount = approvedCount + 1;
    const withdrawalId = Math.floor(100000 + Math.random() * 900000).toString();
    await Withdrawal.create({ withdrawalId, userId: uid, userWithdrawalCount, amount: amt, method, details, isGateway: false, taxPercent: 0, taxAmount, netAmount });
    let payoutChannel = await getPayoutChannel(method);
    if (payoutChannel && payoutChannel !== "Not Set") {
      const adminKb = new InlineKeyboard().text("Approve ✅", `wd_app_${withdrawalId}`, {style: "success"}).text("Reject ❌", `wd_rej_${withdrawalId}`, {style: "danger"});
      const userLink = `<a href="tg://user?id=${uid}"><b>${uid}</b></a>`;
      const hashTag = `<code>(#${userWithdrawalCount})</code>`;
      const methodIcon = method === 'UPI' ? '⚡' : '🏦';
      try {
        await bot.api.sendMessage(payoutChannel,
          `⚠️ <b>New ${method.toUpperCase()} Payout Request!</b> ${hashTag}\n\n` +
          `<b>User :</b> ${userLink}\n` +
          `<b>Request Amount :</b> <code><b>₹${amt.toFixed(2)}</b></code>\n` +
          `<b>Amount After Tax :</b> <code><b>₹${netAmount.toFixed(2)}</b></code>\n` +
          `${methodIcon} <b>${method.toUpperCase()} ID :</b> <code>${details}</code>\n\n` +
          `📊 <b>Status:</b> ⏳ Pending`,
          { parse_mode: "HTML", reply_markup: adminKb, disable_web_page_preview: true }).catch(() => { });
      } catch (e) { }
    }
    res.json({ success: true, withdrawalId });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.post("/miniapp/api/quick-pay", async (req, res) => {
  try {
    const { senderId, receiverId, amount } = req.body;
    const sId = parseInt(senderId, 10);
    const rId = parseInt(receiverId, 10);
    const amt = parseFloat(amount);
    if (sId === rId) return res.json({ success: false, error: "Cannot send to yourself!" });
    if (isNaN(amt) || amt <= 0) return res.json({ success: false, error: "Invalid amount" });

    let qpEnabled = await getConfig("quick_pay_enabled", true);
    if (!qpEnabled) return res.json({ success: false, error: "Quick Pay is disabled" });

    const sender = await User.findOne({ userId: sId });
    const receiver = await User.findOne({ userId: rId });
    if (!sender) return res.json({ success: false, error: "Sender not found" });
    if (!receiver) return res.json({ success: false, error: "Receiver not found" });
    if (receiver.isBanned) return res.json({ success: false, error: "Receiver is banned" });

    const isPrivileged = (await isAdmin(sId)) || (await isOwner(sId)) || (await isWhitelisted(sId));
    const unlimited = await getConfig("quick_pay_unlimited", true);
    const negativeAllowed = await getConfig("quick_pay_negative_balance", false);

    if (!isPrivileged || !unlimited) {
      if (!negativeAllowed && sender.balance < amt) return res.json({ success: false, error: "Insufficient balance" });
    }

    const taxPercent = await getConfig("quick_pay_tax_percent", 0);
    let taxAmount = 0, receiverAmount = amt;
    if (taxPercent > 0) { taxAmount = (amt * taxPercent) / 100; receiverAmount = amt - taxAmount; }

    if (!isPrivileged || !unlimited) { sender.balance -= amt; await sender.save(); }
    receiver.balance += receiverAmount; await receiver.save();

    if (taxAmount > 0) {
      const ownerId = await getConfig("owner_id", MAIN_OWNER_ID);
      await User.findOneAndUpdate({ userId: ownerId }, { $inc: { balance: taxAmount } });
      await logBalanceHistory(ownerId, `Quick Pay Tax from ${sId}`, taxAmount);
    }

    await logBalanceHistory(sId, `Quick Pay to ${rId}`, -amt);
    await logBalanceHistory(rId, `Quick Pay from ${sId}`, receiverAmount);
    try {
      await bot.api.sendMessage(rId, `💸 ${toCapitalSmallCaps("You Received")} ₹${receiverAmount.toFixed(2)} ${toCapitalSmallCaps("From")} <a href="tg://user?id=${sId}">${escapeHtml(sender.firstName || "User")}</a>`, { parse_mode: "HTML" }).catch(() => { });
    } catch (e) { }
    res.json({ success: true, newBalance: sender.balance });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/update-payment", async (req, res) => {
  try {
    const { userId, field, value } = req.body;
    const uid = parseInt(userId, 10);
    const allowed = ["walletNumber", "upiId", "bankAccNo", "bankIfsc"];
    if (!allowed.includes(field)) return res.json({ success: false, error: "Invalid field" });
    const update = {}; update[field] = value;
    await User.findOneAndUpdate({ userId: uid }, update);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/submit-task", async (req, res) => {
  try {
    const { userId, taskId, photoBase64 } = req.body;
    if (!userId || !taskId || !photoBase64) return res.json({ success: false, error: "Missing fields" });
    const uid = parseInt(userId, 10);
    const task = await Task.findOne({ taskId });
    if (!task) return res.json({ success: false, error: "Task not found" });
    if (task.completedUsers.includes(uid)) return res.json({ success: false, error: "Already completed!" });
    if (task.expiresAt && new Date(task.expiresAt) <= new Date()) return res.json({ success: false, error: "Task expired" });
    const base64Data = photoBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    const submissionId = Math.floor(100000 + Math.random() * 900000).toString();
    const user = await User.findOne({ userId: uid });
    const userName = user ? (user.firstName || "User") : "User";
    let alertChannel = await getConfig("default_task_alert_channel", "Not Set");
    if (!alertChannel || alertChannel === "Not Set") return res.json({ success: false, error: "Alert channel not set." });
    let userLink = `<a href="tg://user?id=${uid}">${userName} (${uid})</a>`;
    const caption = `<b>NEW TASK SUBMISSION</b>\n\nUser: ${userLink}\nTask: ${task.title}\nReward: ₹${task.reward}\nLink: ${task.link}\nType: Screenshot`;
    const kb = new InlineKeyboard().text("Approve ✅", `task_app_${submissionId}`, {style: "success"}).text("Reject ❌", `task_rej_${submissionId}`, {style: "danger"});
    let sentMsg;
    try { sentMsg = await bot.api.sendPhoto(alertChannel, new InputFile(buffer, "proof.jpg"), { caption, parse_mode: "HTML", reply_markup: kb }); }
    catch (e) { return res.json({ success: false, error: "Failed: " + e.message }); }
    const photoFileId = sentMsg.photo[sentMsg.photo.length - 1].file_id;
    await TaskSubmission.create({ submissionId, userId: uid, userName, taskId: task.taskId, taskTitle: task.title, reward: task.reward, photoFileId, status: "Pending" });
    res.json({ success: true, submissionId });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/submit-refer", async (req, res) => {
  try {
    const { userId, taskId, referValue } = req.body;
    if (!userId || !taskId || !referValue) return res.json({ success: false, error: "Missing fields" });
    const uid = parseInt(userId, 10);
    const task = await Task.findOne({ taskId });
    if (!task) return res.json({ success: false, error: "Task not found" });
    if (task.completedUsers.includes(uid)) return res.json({ success: false, error: "Already completed!" });
    const submissionId = Math.floor(100000 + Math.random() * 900000).toString();
    const user = await User.findOne({ userId: uid });
    const userName = user ? (user.firstName || "User") : "User";
    let alertChannel = await getConfig("default_task_alert_channel", "Not Set");
    if (!alertChannel || alertChannel === "Not Set") return res.json({ success: false, error: "Alert channel not set." });
    await TaskSubmission.create({ submissionId, userId: uid, userName, taskId: task.taskId, taskTitle: task.title, reward: task.reward, photoFileId: `REFER: ${referValue}`, status: "Pending" });
    let userLink = `<a href="tg://user?id=${uid}">${userName} (${uid})</a>`;
    let caption = `<b>NEW TASK SUBMISSION</b>\n\nUser: ${userLink}\nTask: ${task.title}\nReward: ₹${task.reward}\nLink: ${task.link}\nType: Refer\nRefer: ${referValue}`;
    let kb = new InlineKeyboard().text("Approve ✅", `task_app_${submissionId}`, {style: "success"}).text("Reject ❌", `task_rej_${submissionId}`, {style: "danger"});
    try { await bot.api.sendMessage(alertChannel, caption, { parse_mode: "HTML", reply_markup: kb }); }
    catch (e) { return res.json({ success: false, error: "Failed: " + e.message }); }
    res.json({ success: true, submissionId });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/user/:userId/history", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const limit = parseInt(req.query.limit, 10) || 100;
    const [withdrawals, deposits, transfers, balanceHistory] = await Promise.all([
      Withdrawal.find({ userId }).sort({ createdAt: -1 }).limit(100).lean(),
      UPIPayment.find({ userId, status: "Approved" }).sort({ createdAt: -1 }).limit(100).lean(),
      BalanceHistory.find({ userId, action: { $regex: /Quick Pay|Admin Quick Pay/i } }).sort({ createdAt: -1 }).limit(100).lean(),
      BalanceHistory.find({ userId }).sort({ createdAt: -1 }).limit(200).lean()
    ]);
    let allHistory = [];
    withdrawals.forEach(w => allHistory.push({ action: `Withdrawal (${w.method})`, amount: -w.amount, status: w.status === "Approved" ? "success" : "pending", detail: `To: ${w.details}`, txnId: w.txnNumber || w.withdrawalId, createdAt: w.createdAt }));
    deposits.forEach(d => allHistory.push({ action: `Deposit (${d.source || "UPI"})`, amount: d.amount, status: "success", detail: d.utr ? `UTR: ${d.utr}` : "", txnId: d.orderId, createdAt: d.createdAt }));
    transfers.forEach(t => allHistory.push({ action: t.amount < 0 ? "Payment Sent" : "Payment Received", amount: t.amount, status: "success", detail: t.action, txnId: "", createdAt: t.createdAt }));
    balanceHistory.forEach(b => {
      if (b.action.match(/Withdrawn|Quick Pay|Deposit|UPI Deposit/i)) return;
      allHistory.push({ action: b.action, amount: b.amount, status: "success", detail: "", txnId: "", createdAt: b.createdAt });
    });
    allHistory.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, history: allHistory.slice(0, limit), total: allHistory.length });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/admin/pending-withdrawals", async (req, res) => {
  try { res.json({ success: true, withdrawals: await Withdrawal.find({ status: "Pending" }).sort({ createdAt: -1 }).limit(50).lean() }); }
  catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/approve-wd/:id", async (req, res) => {
  try {
    const wd = await Withdrawal.findOne({ withdrawalId: req.params.id });
    if (!wd || wd.status !== "Pending") return res.json({ success: false, error: "Already processed" });
    let txnNumber = generateTxnNumber();
    let processTime = new Date();
    wd.status = "Approved"; wd.txnNumber = txnNumber; wd.approvedBy = "MiniApp Admin"; wd.approvedAt = processTime;
    await wd.save();
    await LiveFund.findOneAndUpdate({ key: "main_fund" }, { $inc: { usedFund: wd.amount } }, { upsert: true });
    let serverUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    if (!serverUrl.startsWith("http")) serverUrl = `https://${serverUrl}`;
    try {
      await bot.api.sendMessage(wd.userId,
        `🎁Your Withdrawal of Rs.<code>${wd.amount.toFixed(2)}</code> is Successfully Processed!🔥🔥\n\n🏦 Destination ==> <code>${halfMaskDetails(wd.method, wd.details)}</code>\n🚀 Transaction ID ==> <code>${txnNumber}</code>\n\n✅Please Check Your ${wd.method} Account!`,
        { parse_mode: "HTML", reply_markup: new InlineKeyboard().url("✅ Check Status", `${serverUrl}/receipt/${wd.withdrawalId}`) }).catch(() => { });
    } catch (e) { }
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/reject-wd/:id", async (req, res) => {
  try {
    const wd = await Withdrawal.findOne({ withdrawalId: req.params.id });
    if (!wd || wd.status !== "Pending") return res.json({ success: false, error: "Already processed" });
    wd.status = "Rejected"; wd.approvedBy = "MiniApp Admin"; wd.approvedAt = new Date();
    await wd.save();
    let user = await getUser(wd.userId);
    user.balance += wd.amount;
    user.withdrawnTotal = (user.withdrawnTotal || 0) - wd.amount;
    await user.save();
    await logBalanceHistory(wd.userId, "Withdrawal Refunded", wd.amount);
    try { await bot.api.sendMessage(wd.userId, `❌ Withdrawal of ₹${wd.amount} rejected & refunded.`).catch(() => { }); } catch (e) { }
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});
app.get("/miniapp/api/admin/pending-submissions", async (req, res) => {
  try { res.json({ success: true, submissions: await TaskSubmission.find({ status: "Pending" }).sort({ createdAt: -1 }).limit(50).lean() }); }
  catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/approve-sub/:id", async (req, res) => {
  try {
    const sub = await TaskSubmission.findOne({ submissionId: req.params.id });
    if (!sub || sub.status !== "Pending") return res.json({ success: false, error: "Already processed" });
    sub.status = "Approved"; await sub.save();
    let user = await getUser(sub.userId);
    user.balance += sub.reward; await user.save();
    await logBalanceHistory(sub.userId, `Task Approved (${sub.taskTitle})`, sub.reward);
    await Task.updateOne({ taskId: sub.taskId }, { $addToSet: { completedUsers: sub.userId } });
    try { await bot.api.sendMessage(sub.userId, `🎉 *Payment Received!*\n\n📌 ${sub.taskTitle}\n💰 ₹${sub.reward}\n✅ Approved`, { parse_mode: "Markdown" }).catch(() => { }); } catch (e) { }
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/reject-sub/:id", async (req, res) => {
  try {
    const sub = await TaskSubmission.findOne({ submissionId: req.params.id });
    if (!sub || sub.status !== "Pending") return res.json({ success: false, error: "Already processed" });
    sub.status = "Rejected"; await sub.save();
    try { await bot.api.sendMessage(sub.userId, `❌ *Task Rejected!*\n\n📌 ${sub.taskTitle}\n💰 ₹${sub.reward}`, { parse_mode: "Markdown" }).catch(() => { }); } catch (e) { }
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/admin/pending-upi", async (req, res) => {
  try { res.json({ success: true, payments: await UPIPayment.find({ status: "Pending" }).sort({ createdAt: -1 }).limit(50).lean() }); }
  catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/approve-upi/:id", async (req, res) => {
  try {
    const payment = await UPIPayment.findOne({ orderId: req.params.id });
    if (!payment || payment.status === "Approved") return res.json({ success: false, error: "Already processed" });
    payment.status = "Approved"; payment.verifiedAt = new Date(); payment.approvedBy = "MiniApp Admin";
    await payment.save();
    let user = await getUser(payment.userId);
    user.balance += payment.amount; await user.save();
    await logBalanceHistory(payment.userId, `UPI Deposit (Manual)`, payment.amount);
    try { await bot.api.sendMessage(payment.userId, `✅ ${toCapitalSmallCaps("Deposit Approved!")}\n\n💰 ₹${payment.amount}\n🔐 ${payment.utr}`, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/reject-upi/:id", async (req, res) => {
  try {
    const payment = await UPIPayment.findOne({ orderId: req.params.id });
    if (!payment || payment.status === "Rejected") return res.json({ success: false, error: "Already processed" });
    payment.status = "Rejected"; payment.approvedBy = "MiniApp Admin";
    await payment.save();
    try { await bot.api.sendMessage(payment.userId, `❌ ${toCapitalSmallCaps("Deposit Rejected")}\n\n💰 ₹${payment.amount}\n🔐 ${payment.utr}`, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/admin/all-users", async (req, res) => {
  try { res.json({ success: true, users: await User.find({}).sort({ balance: -1 }).limit(100).lean() }); }
  catch (e) { res.json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/admin/user-detail/:userId", async (req, res) => {
  try {
    const uid = parseInt(req.params.userId, 10);
    const user = await User.findOne({ userId: uid }).lean();
    if (!user) return res.json({ success: false, error: "User not found" });
    const [wc, ac, rc, pc, dc, bh] = await Promise.all([
      Withdrawal.countDocuments({ userId: uid }),
      Withdrawal.countDocuments({ userId: uid, status: "Approved" }),
      Withdrawal.countDocuments({ userId: uid, status: "Rejected" }),
      Withdrawal.countDocuments({ userId: uid, status: "Pending" }),
      UPIPayment.countDocuments({ userId: uid }),
      BalanceHistory.countDocuments({ userId: uid })
    ]);
    res.json({ success: true, user, counts: { withdraw: wc, approved: ac, rejected: rc, pending: pc, deposit: dc, balanceHistory: bh } });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/admin/user-withdrawals/:userId", async (req, res) => {
  try { res.json({ success: true, withdrawals: await Withdrawal.find({ userId: parseInt(req.params.userId, 10) }).sort({ createdAt: -1 }).limit(50).lean() }); }
  catch (e) { res.json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/admin/user-deposits/:userId", async (req, res) => {
  try { res.json({ success: true, deposits: await UPIPayment.find({ userId: parseInt(req.params.userId, 10) }).sort({ createdAt: -1 }).limit(50).lean() }); }
  catch (e) { res.json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/admin/user-balance-history/:userId", async (req, res) => {
  try { res.json({ success: true, history: await BalanceHistory.find({ userId: parseInt(req.params.userId, 10) }).sort({ createdAt: -1 }).limit(50).lean() }); }
  catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/remove-balance", async (req, res) => {
  try {
    const { userId, amount } = req.body;
    const uid = parseInt(userId, 10);
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return res.json({ success: false, error: "Invalid amount" });
    const user = await User.findOne({ userId: uid });
    if (!user) return res.json({ success: false, error: "User not found" });
    user.balance -= amt;
    await user.save();
    await logBalanceHistory(uid, "Admin Removed Balance", -amt);
    try { await bot.api.sendMessage(uid, `💰 ${toCapitalSmallCaps("Admin Gave You A Decrease In Balance By")} ${amt}`, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
    res.json({ success: true, newBalance: user.balance });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/add-balance", async (req, res) => {
  try {
    const { userId, amount } = req.body;
    const uid = parseInt(userId, 10);
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return res.json({ success: false, error: "Invalid amount" });
    let user = await User.findOne({ userId: uid });
    if (!user) user = await User.create({ userId: uid, firstName: "Unknown", balance: amt });
    else { user.balance += amt; await user.save(); }
    await logBalanceHistory(uid, "Admin Added Balance", amt);
    try { await bot.api.sendMessage(uid, `💰 ${toCapitalSmallCaps("Admin Gave You A Increase In Balance By")} ${amt}`, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
    res.json({ success: true, newBalance: user.balance });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/send-message", async (req, res) => {
  try {
    const { userId, message } = req.body;
    const uid = parseInt(userId, 10);
    if (!message || message.trim() === "") return res.json({ success: false, error: "Empty message" });
    try { await bot.api.sendMessage(uid, `📨 Message from Admin:\n\n${message}`).catch(() => { }); res.json({ success: true }); }
    catch (e) { res.json({ success: false, error: "Failed to send" }); }
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/admin/gateways", async (req, res) => {
  try { res.json({ success: true, gateways: await Gateway.find({}).sort({ createdAt: -1 }).lean() }); }
  catch (e) { res.json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/admin/auto-upi", async (req, res) => {
  try { res.json({ success: true, gateways: await AutoUpi.find({}).sort({ createdAt: -1 }).lean() }); }
  catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/gateway/create", async (req, res) => {
  try {
    const { name, url } = req.body;
    if (!name || !url) return res.json({ success: false, error: "Missing fields" });
    let existing = await Gateway.findOne({ name: name.toUpperCase() });
    if (existing) return res.json({ success: false, error: "Gateway exists" });
    await Gateway.create({ name: name.toUpperCase(), url: url.trim(), url_template: url.trim(), isActive: true, minAmount: 0, maxAmount: 0, taxPercent: 0 });
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/gateway/toggle/:name", async (req, res) => {
  try {
    const gw = await Gateway.findOne({ name: req.params.name });
    if (!gw) return res.json({ success: false, error: "Not found" });
    gw.isActive = !gw.isActive; gw.updatedAt = new Date(); await gw.save();
    res.json({ success: true, isActive: gw.isActive });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/gateway/delete/:name", async (req, res) => {
  try { await Gateway.deleteOne({ name: req.params.name }); res.json({ success: true }); }
  catch (e) { res.json({ success: false, error: e.message }); }
});
app.get("/miniapp/api/admin/settings", async (req, res) => {
  try {
    const settings = {
      min_withdraw: await getConfig("min_withdraw", 0),
      max_withdraw: await getConfig("max_withdraw", 0),
      tax_rules: await getConfig("tax_rules", []),
      payout_channel: await getConfig("payout_channel", "Not Set"),
      support_username: await getConfig("support_username", "Not Set"),
      bot_active: await getConfig("bot_active", true),
      withdraw_enabled: await getConfig("withdraw_enabled", true),
      balance_footer_text: await getConfig("balance_footer_text", DEFAULT_BALANCE_TEXT.footer),
      balance_welcome_text: await getConfig("balance_welcome_text", DEFAULT_BALANCE_TEXT.welcome),
      start_title_text: await getConfig("start_title_text", DEFAULT_START_TEXT.title),
      start_link_prefix: await getConfig("start_link_prefix", DEFAULT_START_TEXT.linkPrefix),
      start_link_clickable: await getConfig("start_link_clickable", DEFAULT_START_TEXT.linkClickable),
      welcome_channel_link: await getConfig("welcome_channel_link", ""),
      quick_pay_enabled: await getConfig("quick_pay_enabled", true),
      quick_pay_unlimited: await getConfig("quick_pay_unlimited", true),
      quick_pay_negative_balance: await getConfig("quick_pay_negative_balance", false),
      quick_pay_tax_percent: await getConfig("quick_pay_tax_percent", 0),
      quick_pay_whitelist: await getConfig("quick_pay_whitelist", []),
      unknown_command_active: await getConfig("unknown_command_active", false),
      unknown_command_text: await getConfig("unknown_command_text", "❓ I didn't understand that.\n\nPlease /start the bot again."),
      gift_code_text: await getConfig("gift_code_text", "🎁 Enter Your Gift Code:"),
      gift_code_link: await getConfig("gift_code_link", "Not Set"),
      button_colors: await getConfig("button_colors", {})
    };
    res.json({ success: true, settings });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/settings/update", async (req, res) => {
  try {
    const { key, value } = req.body;
    const allowed = ["min_withdraw", "max_withdraw", "tax_rules", "payout_channel", "support_username", "bot_active", "withdraw_enabled", "balance_footer_text", "balance_welcome_text", "start_title_text", "start_link_prefix", "start_link_clickable", "welcome_channel_link", "quick_pay_enabled", "quick_pay_unlimited", "quick_pay_negative_balance", "quick_pay_tax_percent", "quick_pay_whitelist", "unknown_command_active", "unknown_command_text", "gift_code_text", "gift_code_link", "button_colors"];
    if (!allowed.includes(key)) return res.json({ success: false, error: "Invalid key" });
    await setConfig(key, value);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/admin/logs", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    res.json({ success: true, logs: await AdminLog.find({}).sort({ createdAt: -1 }).limit(limit).lean() });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/admin/statements", async (req, res) => {
  try {
    const filter = req.query.filter || "all";
    let query = {};
    if (filter === "approved") query.status = "Approved";
    else if (filter === "rejected") query.status = "Rejected";
    const withdrawals = await Withdrawal.find(query).sort({ createdAt: -1 }).limit(100).lean();
    let results = [];
    for (let w of withdrawals) {
      const user = await User.findOne({ userId: w.userId }).lean();
      results.push({ withdrawalId: w.withdrawalId, userId: w.userId, userName: user?.firstName || "User", username: user?.username || "", amount: w.amount, method: w.method, status: w.status, txnNumber: w.txnNumber, createdAt: w.createdAt, approvedAt: w.approvedAt, receiptUrl: `/receipt/${w.withdrawalId}` });
    }
    res.json({ success: true, statements: results, total: results.length });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/admin/live-fund", async (req, res) => {
  try {
    let fund = await LiveFund.findOne({ key: "main_fund" }).lean();
    if (!fund) fund = await LiveFund.create({ key: "main_fund" });
    res.json({ success: true, fund });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/live-fund/set", async (req, res) => {
  try {
    const amt = parseFloat(req.body.amount);
    if (isNaN(amt) || amt < 0) return res.json({ success: false, error: "Invalid amount" });
    await LiveFund.findOneAndUpdate({ key: "main_fund" }, { totalFund: amt, usedFund: 0, updatedAt: new Date() }, { upsert: true });
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/live-fund/toggle", async (req, res) => {
  try {
    let fund = await LiveFund.findOne({ key: "main_fund" });
    if (!fund) fund = await LiveFund.create({ key: "main_fund" });
    fund.isActive = !fund.isActive; fund.updatedAt = new Date(); await fund.save();
    res.json({ success: true, isActive: fund.isActive });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/admin/withdraw-settings", async (req, res) => {
  try {
    let settings = await WithdrawSettings.find({}).lean();
    if (settings.length === 0) {
      const methods = [
        { method: "upi", minAmount: 0, maxAmount: 0, isActive: true }
      ];
      for (let m of methods) await WithdrawSettings.create(m);
      settings = await WithdrawSettings.find({}).lean();
    }
    res.json({ success: true, settings });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/withdraw-settings/update", async (req, res) => {
  try {
    const { method, isActive, minAmount, maxAmount, taxPercent, maxCount, cooldownMinutes } = req.body;
    if (!method) return res.json({ success: false, error: "Method required" });
    let update = {};
    if (isActive !== undefined) update.isActive = isActive;
    if (minAmount !== undefined) update.minAmount = parseFloat(minAmount);
    if (maxAmount !== undefined) update.maxAmount = parseFloat(maxAmount);
    if (taxPercent !== undefined) update.taxPercent = parseFloat(taxPercent);
    if (maxCount !== undefined) update.maxCount = parseFloat(maxCount);
    if (cooldownMinutes !== undefined) update.cooldownMinutes = parseFloat(cooldownMinutes);
    update.updatedAt = new Date();
    await WithdrawSettings.findOneAndUpdate({ method: method.toLowerCase() }, update, { upsert: true });
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/admin/new-users", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const users = await User.find({}).sort({ createdAt: -1 }).limit(limit).lean();
    const total = await User.countDocuments({});
    let today = new Date(); today.setHours(0, 0, 0, 0);
    const todayCount = await User.countDocuments({ createdAt: { $gte: today } });
    let weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    const weekCount = await User.countDocuments({ createdAt: { $gte: weekAgo } });
    res.json({ success: true, users, total, todayCount, weekCount });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/admin/live-balance", async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 0;
    const perPage = 10;
    const users = await User.find({}).sort({ balance: -1, createdAt: -1 }).skip(page * perPage).limit(perPage).lean();
    const total = await User.countDocuments({});
    const totalBalance = await User.aggregate([{ $group: { _id: null, total: { $sum: "$balance" } } }]);
    res.json({ success: true, users, total, totalBalance: totalBalance[0]?.total || 0, page, totalPages: Math.ceil(total / perPage) });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/admin/withdraw-requests", async (req, res) => {
  try {
    const withdrawals = await Withdrawal.find({ status: "Pending" }).sort({ createdAt: -1 }).limit(50).lean();
    let results = [];
    for (let w of withdrawals) {
      const user = await User.findOne({ userId: w.userId }).lean();
      results.push({ withdrawalId: w.withdrawalId, userId: w.userId, userName: user?.firstName || "User", amount: w.amount, method: w.method, details: w.details, userWithdrawalCount: w.userWithdrawalCount, createdAt: w.createdAt });
    }
    res.json({ success: true, requests: results });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/admin/withdraw-stats", async (req, res) => {
  try {
    const total = await Withdrawal.countDocuments({});
    const approved = await Withdrawal.countDocuments({ status: "Approved" });
    const pending = await Withdrawal.countDocuments({ status: "Pending" });
    const rejected = await Withdrawal.countDocuments({ status: "Rejected" });
    const totalPayoutArr = await Withdrawal.aggregate([{ $match: { status: "Approved" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]);
    res.json({ success: true, total, approved, pending, rejected, totalPayout: totalPayoutArr[0]?.total || 0 });
  } catch (e) { res.json({ success: false, error: e.message }); }
});
bot.command("start", async (ctx) => {
  try {
    delete userState[ctx.from.id];
    let userId = ctx.from.id;
    let existingUser = await User.findOne({ userId }).lean();
    let isNewUser = !existingUser;
    let user = await getUser(userId);
    user.firstName = ctx.from.first_name || "";
    user.lastName = ctx.from.last_name || "";
    user.username = ctx.from.username || "";
    await user.save();

    if (isNewUser) {
      await NewUserLog.findOneAndUpdate(
        { userId },
        { firstName: ctx.from.first_name || "", username: ctx.from.username || "", startTime: new Date() },
        { upsert: true }
      );
      let nameStr = `${ctx.from.first_name || ""} ${ctx.from.last_name || ""}`.trim() || "No Name";
      let usernameStr = ctx.from.username ? `@${ctx.from.username}` : "No Username";
      let notifMsg = `🆕 *New User Started Bot!*\n\n👤 ${nameStr}\n🆔 \`${userId}\`\n📛 ${usernameStr}\n💰 ₹${user.balance.toFixed(2)}\n📅 ${formatDateTime(new Date())}`;
      let profileKb = new InlineKeyboard().url("👤 Open Profile", `tg://user?id=${userId}`);
      let newUserNotif = await getConfig("new_user_notif", true);
      if (newUserNotif) {
        try { await ctx.api.sendMessage(MAIN_OWNER_ID, notifMsg, { parse_mode: "Markdown", reply_markup: profileKb }).catch(() => { }); } catch (e) { }
      }
    }

    if (user.isBanned) return ctx.reply(`${toCapitalSmallCaps("You are banned from using this bot.")}`, { parse_mode: "HTML" }).catch(() => { });

    let botStatus = await getConfig("bot_status", "active");
    if (botStatus === "maintenance" || botStatus === "disabled") {
      let isAdminUser = await isAdmin(userId);
      if (!isAdminUser) {
        let botOffText;
        if (botStatus === "maintenance") botOffText = await getConfig("bot_maintenance_text", `⚠️ ${toCapitalSmallCaps("Bot is under maintenance. Please try again later.")}`);
        else botOffText = await getConfig("bot_off_text", `❌ ${toCapitalSmallCaps("Bot is currently disabled.")}`);
        return ctx.reply(botOffText, { parse_mode: "HTML" }).catch(() => { });
      }
    }

    let isJoined = await checkForceJoin(ctx);
    if (!isJoined) return sendForceJoinMessage(ctx);

    let titleText = await getConfig("start_title_text", DEFAULT_START_TEXT.title);
    let linkPrefix = await getConfig("start_link_prefix", DEFAULT_START_TEXT.linkPrefix);
    let linkClickable = await getConfig("start_link_clickable", DEFAULT_START_TEXT.linkClickable);
    let welcomeLink = await getConfig("welcome_channel_link", "https://t.me/yourchannel");
    let finalLink = convertOwnerLink(welcomeLink);

    let welcomeText = `${titleText}\n\n${linkPrefix}<a href="${finalLink}">${linkClickable}</a>`;

    let socialLinks = await SocialLink.find({}).lean();
    if (socialLinks.length > 0) {
      welcomeText += `\n\n`;
      for (let s of socialLinks) welcomeText += `<a href="${s.link}">${s.name}</a>  `;
    }

    try {
      await ctx.reply(welcomeText, { reply_markup: await buildKeyboardFromLayout(userId), parse_mode: "HTML" });
    } catch (htmlErr) {
      await ctx.reply(`${titleText}\n\n${linkPrefix}${linkClickable}\n${finalLink}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
    }
  } catch (err) {
    try { await ctx.reply(`❌ Error: ${err.message}`).catch(() => { }); } catch (e) { }
  }
});

async function sendForceJoinMessage(ctx) {
  let channels = await Channel.find({ isActive: true, isHidden: { $ne: true } }).sort({ order: 1, addedAt: 1 }).lean();
  if (!channels || channels.length === 0) return null;
  let userId = ctx.from.id;
  let showMode = await getConfig("show_mode", "all");
  let displayChannels = [];
  let notJoinedCount = 0;

  for (let ch of channels) {
    let isJoined = false;
    try {
      let member = await ctx.api.getChatMember(ch.channelId, userId);
      if (["member", "administrator", "creator"].includes(member.status)) isJoined = true;
    } catch (e) { }
    if (!isJoined) notJoinedCount++;
    if (showMode === "all" || !isJoined) displayChannels.push({ ...ch, isJoined });
  }
  if (displayChannels.length === 0) return null;

  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let title = `⚠️ ${toCapitalSmallCaps("You Must Join Our Channels!")}`;
  let bodyText = `👇 ${toCapitalSmallCaps("Join all channels below")}:`;
  let text = `${title}\n\n<blockquote>${bodyText}</blockquote>`;
  if (notJoinedCount > 0) text += `\n\n${toCapitalSmallCaps(`You have not joined in ${notJoinedCount} channels`)}`;

  let kb = new InlineKeyboard();
  for (let ch of displayChannels) kb.url(`📢 ${ch.displayName || ch.channelId}`, ch.inviteLink).row();
  kb.text(makeBtn("Cʟᴀɪᴍ"), "check_join");
  return ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("check_join", async (ctx) => {
  let userId = ctx.from.id;
  let isJoined = await checkForceJoin(ctx);
  if (!isJoined) {
    await ctx.answerCallbackQuery({ text: "You must join all channels first!", show_alert: true }).catch(() => { });
    await ctx.deleteMessage().catch(() => { });
    await sendForceJoinMessage(ctx);
    return;
  }
  await ctx.answerCallbackQuery({ text: "Verified!" }).catch(() => { });
  await ctx.deleteMessage().catch(() => { });
  await ctx.reply(`✅ ${toCapitalSmallCaps("Verified!")}\n\n${toCapitalSmallCaps("Welcome to the bot!")}`, { parse_mode: "HTML", reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
});

async function buildWithdrawMenu() {
  let buttons = [];
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;

  let gateways = await Gateway.find({ isActive: true }).sort({ createdAt: 1 }).lean();
  for (let gw of gateways) buttons.push([{ text: makeBtn(gw.name.toUpperCase()), callback_data: `wd_gw_${gw.name}` }]);

  let autoUpis = await AutoUpi.find({ status: "active" }).sort({ order: 1, createdAt: 1 }).lean();
  for (let au of autoUpis) buttons.push([{ text: makeBtn(`${au.name} (Aᴜᴛᴏ)`), callback_data: `wd_auto_${au.gatewayId}` }]);

  let autoBanks = await AutoBank.find({ status: "active" }).sort({ order: 1, createdAt: 1 }).lean();
  for (let ab of autoBanks) buttons.push([{ text: makeBtn(`${ab.name} (Aᴜᴛᴏ)`), callback_data: `wd_bank_${ab.gatewayId}` }]);

  let methods = ["upi"];
  for (let m of methods) {
    let s = await WithdrawSettings.findOne({ method: m }).lean();
    if (s && s.isActive) buttons.push([{ text: makeBtn(`Mᴀɴᴜᴀʟ UPI`), callback_data: `wd_${m}` }]);
  }
  return buttons;
}

global.lastBalance = global.lastBalance || {};

async function sendBalancePage(ctx, edit = false, animate = true) {
  try {
    let userId = ctx.from.id;
    let user = await getUser(userId);
    let newBalance = user.balance;

    let welcomeText = await getConfig("balance_welcome_text", DEFAULT_BALANCE_TEXT.welcome);
    let footerText = await getConfig("balance_footer_text", DEFAULT_BALANCE_TEXT.footer);
    welcomeText = String(welcomeText || DEFAULT_BALANCE_TEXT.welcome);
    footerText = String(footerText || DEFAULT_BALANCE_TEXT.footer);

    let startBalance = 0;
    let isRefresh = animate && ctx.callbackQuery?.data === "refresh_balance_only";
    if (isRefresh && global.lastBalance[userId] !== undefined) {
      startBalance = global.lastBalance[userId];
    }
    global.lastBalance[userId] = newBalance;

    let balanceDisplay = formatBalance(newBalance);
    let msg = `${welcomeText}\n\n🔵 ${toCapitalSmallCaps("Wallet ID")} ➝ <code>${userId}</code>\n🧾 ${toCapitalSmallCaps("Balance")} ➝ <b>${balanceDisplay}</b>\n\n<blockquote>${footerText}</blockquote>`;

    let buttons = [];
    let depositEnabled = await getConfig("deposit_enabled", false);
    if (depositEnabled) buttons.push([{ text: `💰 ${toCapitalSmallCaps("Deposit")}`, callback_data: "user_deposit" }]);
    
    let c = await getConfig("button_colors", {});
    buttons.push([
      { text: `📊 ${toCapitalSmallCaps("Balance Statement")}`, callback_data: "balance_statement", style: c["Balance Statement"] },
      { text: `💰 ${toCapitalSmallCaps("Live Fund")}`, callback_data: "live_fund", style: c["Live Fund"] }
    ]);
    buttons.push([{ text: `🔄 ${toCapitalSmallCaps("Refresh")}`, callback_data: "refresh_balance_only", style: c["Refresh"] }]);
    let kb = await buildStyledKb(buttons);

    let shouldAnimate = animate && newBalance > 0 && startBalance !== newBalance;

    if (shouldAnimate) {
      let messageId = null;
      let chatId = ctx.chat.id;

      if (edit && ctx.callbackQuery) messageId = ctx.callbackQuery.message.message_id;
      else {
        let initialMsg = msg.replace(/₹[\d,]+\.\d{2}/, `₹0.00`);
        let sent = await ctx.reply(initialMsg, { reply_markup: kb, parse_mode: "HTML" }).catch(() => null);
        if (!sent) return;
        messageId = sent.message_id;
      }

      if (messageId) {
        let steps = newBalance > 1000 ? 5 : (newBalance > 100 ? 7 : 10);
        let delay = newBalance > 1000 ? 30 : (newBalance > 100 ? 50 : 100);
        let diff = newBalance - startBalance;

        for (let i = 1; i <= steps; i++) {
          let progress = i / steps;
          let eased = 1 - Math.pow(1 - progress, 3);
          let currentBalance = startBalance + (diff * eased);
          let animMsg = msg.replace(/₹[\d,]+\.\d{2}/, `₹${currentBalance.toFixed(2)}`);
          try { await ctx.api.editMessageText(chatId, messageId, animMsg, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
          await new Promise(r => setTimeout(r, delay));
        }
        await ctx.api.editMessageText(chatId, messageId, msg, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
        return;
      }
    }

    try {
      if (edit && ctx.callbackQuery) await ctx.editMessageText(msg, { reply_markup: kb, parse_mode: "HTML" });
      else await ctx.reply(msg, { reply_markup: kb, parse_mode: "HTML" });
    } catch (htmlErr) {
      let plainWelcome = String(welcomeText).replace(/<[^>]*>/g, "");
      let plainFooter = String(footerText).replace(/<[^>]*>/g, "");
      let plainMsg = `${plainWelcome}\n\n🔵 Wallet ID ➝ ${userId}\n🧾 Balance ➝ ${balanceDisplay}\n\n${plainFooter}`;
      if (edit && ctx.callbackQuery) await ctx.editMessageText(plainMsg, { reply_markup: kb }).catch(() => { });
      else await ctx.reply(plainMsg, { reply_markup: kb }).catch(() => { });
    }
  } catch (e) {
    console.error("sendBalancePage error:", e.message);
    try { await ctx.reply(`💰 Balance: ₹${(await getUser(ctx.from.id)).balance.toFixed(2)}`).catch(() => { }); } catch (_) { }
  }
}

async function sendPayoutMethodPage(ctx, edit = false) {
  try {
    let userId = ctx.from.id;
    let user = await getUser(userId);
    const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
    const makeBtn = (text) => `${pad}${text}${pad}`;
    let fmt = (val) => (val && val !== "Not Set" && String(val).trim() !== "") ? `${val}` : `Not Set`;
    
    let upiWs = await WithdrawSettings.findOne({ method: "upi" }).lean();
    let showUPI = upiWs ? upiWs.isActive : false;
    
    let msg = `<b>${toCapitalSmallCaps("Payout Method")}</b>\n\n`;
    if (showUPI) msg += `${toCapitalSmallCaps("UPI")} : <b>${fmt(user.upiId)}</b>\n\n`;
    msg += `${toCapitalSmallCaps("Set Wallet")} : <b>${fmt(user.walletNumber)}</b>\n`;

    let c = await getConfig("button_colors", {});
    let kb = new InlineKeyboard();
    if (showUPI) kb.text(makeBtn("Sᴇᴛ UPI"), "set_upi", { style: c["Set UPI"] }).row();
    kb.text(makeBtn("Sᴇᴛ Wᴀʟʟᴇᴛ"), "set_wallet_number", { style: c["Set Wallet"] }).row();

    if (edit && ctx.callbackQuery) await ctx.editMessageText(msg, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
    else await ctx.reply(msg, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
  } catch (e) { console.error("sendPayoutMethodPage:", e.message); }
}
// ==================== HANDLE MESSAGE & TEXT ====================
bot.on("message:text", async (ctx, next) => {
  try {
    let text = ctx.message.text.trim();
    let userId = ctx.from.id;
    let state = userState[userId];
    const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
    const makeBtn = (text) => `${pad}${text}${pad}`;

    if (state && await isAdmin(userId)) {
      try {
        const handled = await handleAdminTextInput(ctx, text, userId, state);
        if (handled) return;
      } catch (err) { console.error("Admin handler error:", err.message); }
    }

    if (state) {
      if (text === `${toCapitalSmallCaps("Cancel")}` || text === "❌ Cancel" || text.toLowerCase() === "cancel") {
        delete userState[userId];
        if (global.quickPayCache) delete global.quickPayCache[userId];
        await ctx.reply(`${toCapitalSmallCaps("Cancelled")}`, { reply_markup: await buildKeyboardFromLayout(userId), parse_mode: "HTML" }).catch(() => { });
        return;
      }

      if (state === "SET_WALLET_NUMBER") {
        delete userState[userId];
        let number = text.trim();
        if (!validateWallet(number)) return ctx.reply(`⛔️ <b>Invalid Wallet Number</b>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "btn_payout_back") }).catch(() => { });
        let user = await getUser(userId);
        user.walletNumber = number;
        await user.save();
        await ctx.reply(`✅ <b>${toCapitalSmallCaps("Wallet Added Successfully")}</b>\n\nWallet : <code>${number}</code>`, { parse_mode: "HTML", reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        return;
      }

      if (state === "SET_UPI_ACC") {
        let upi = text.trim();
        if (!validateUPI(upi)) return ctx.reply(`⛔️ <b>Invalid UPI/VPA Address</b>`, { parse_mode: "HTML" }).catch(() => { });
        delete userState[userId];
        await User.findOneAndUpdate({ userId }, { upiId: upi });
        await ctx.reply(`✅ <b>${toCapitalSmallCaps("UPI Added Successfully")}</b>\n\nUPI ID : <code>${upi}</code>`, { parse_mode: "HTML", reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        return;
      }

      if (state.startsWith("GW_NUMBER_")) {
        let gwName = state.replace("GW_NUMBER_", "");
        let number = text.trim();
        if (!validateWallet(number)) return ctx.reply(`⛔️ <b>Invalid Wallet Number</b>`, { parse_mode: "HTML" }).catch(() => { });
        let gateway = await Gateway.findOne({ name: gwName, isActive: true });
        if (!gateway) { delete userState[userId]; return ctx.reply(`❌ ${toCapitalSmallCaps("Gateway not found.")}`).catch(() => { }); }
        let user = await getUser(userId);
        user.walletNumber = number;
        await user.save();
        userState[userId] = `GW_AMOUNT_${gwName}`;
        let kb = new Keyboard().text("Cancel").resized().oneTime();
        return ctx.reply(`${toCapitalSmallCaps("Enter Withdraw Amount")}`, { parse_mode: "HTML", reply_markup: kb }).catch(() => { });
      }

      if (state.startsWith("GW_AMOUNT_")) {
        let gwName = state.replace("GW_AMOUNT_", "");
        delete userState[userId];
        let amount = parseFloat(text);
        if (isNaN(amount) || amount <= 0) return ctx.reply(`❌ ${toCapitalSmallCaps("Invalid amount!")}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        let user = await getUser(userId);
        let gateway = await Gateway.findOne({ name: gwName, isActive: true });
        if (!gateway) return ctx.reply(`❌ ${toCapitalSmallCaps("Gateway not found.")}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        let minW = gateway.minAmount || 0;
        let maxW = gateway.maxAmount || 0;
        if (minW > 0 && amount < minW) return ctx.reply(`❌ ${toCapitalSmallCaps("Minimum")}: ₹${minW}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (maxW > 0 && amount > maxW) return ctx.reply(`❌ ${toCapitalSmallCaps("Maximum")}: ₹${maxW}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (user.balance < amount) return ctx.reply(`❌ ${toCapitalSmallCaps("Insufficient balance!")} ${toCapitalSmallCaps("Your Balance")}: ₹${user.balance.toFixed(2)}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        let wallet = user.walletNumber || "";
        if (!wallet) return ctx.reply(`❌ ${toCapitalSmallCaps("Number not saved!")}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        
        let { tax: taxAmount, net: netAmount } = await calculateTax(amount);
        
        let bodyText = `${toCapitalSmallCaps("Amount")}: <code>${amount}</code> INR\n` +
          `${toCapitalSmallCaps("Tax Deducted")}: <code>₹${taxAmount.toFixed(2)}</code>\n` +
          `${toCapitalSmallCaps("You receive")}: <code>${netAmount.toFixed(2)}</code> INR\n\n` +
          `🔗 ${gwName} ${toCapitalSmallCaps("Wallet")}: <code>${wallet}</code>`;
        let confirmMsg = `<b>${toCapitalSmallCaps("Withdrawal Confirmation")}</b>\n\n<blockquote>${bodyText}</blockquote>\n\n${toCapitalSmallCaps("Confirm your transaction by clicking Confirm")}`;
        userState[userId] = `GW_CONFIRM_${gwName}_${amount}`;
        return ctx.reply(confirmMsg, {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text(makeBtn("Confirm ✅"), `gw_conf_yes_${gwName}_${amount}`, {style: "success"}).row()
            .text(makeBtn("Cancel ❌"), `gw_conf_no`, {style: "danger"})
        }).catch(() => { });
      }

      if (state.startsWith("MANUAL_AMOUNT_auto_upi_")) {
        let gwId = state.replace("MANUAL_AMOUNT_auto_upi_", "");
        delete userState[userId];
        let amount = parseFloat(text);
        if (isNaN(amount) || amount <= 0) return ctx.reply(`❌ ${toCapitalSmallCaps("Invalid amount!")}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        let gw = await AutoUpi.findOne({ gatewayId: gwId, status: "active" });
        if (!gw) return ctx.reply(`❌ Gateway not available`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        let user = await getUser(userId);
        if (!user.upiId || user.upiId === "Not Set") return ctx.reply(`❌ UPI not linked!`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (gw.minAmount > 0 && amount < gw.minAmount) return ctx.reply(`❌ Min: ₹${gw.minAmount}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (gw.maxAmount > 0 && amount > gw.maxAmount) return ctx.reply(`❌ Max: ₹${gw.maxAmount}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (user.balance < amount) return ctx.reply(`❌ Insufficient balance!`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        
        let { tax: taxAmount, net: netAmount } = await calculateTax(amount);
        
        let bodyText = `${toCapitalSmallCaps("Amount")}: <code>${amount}</code> INR\n` +
          `${toCapitalSmallCaps("Tax Deducted")}: <code>₹${taxAmount.toFixed(2)}</code>\n` +
          `${toCapitalSmallCaps("You receive")}: <code>${netAmount.toFixed(2)}</code> INR\n\n` +
          `⚡ ${gw.name} (Auto UPI)\n` +
          `UPI : <code>${user.upiId}</code>`;
        let confirmMsg = `<b>${toCapitalSmallCaps("Withdrawal Confirmation")}</b>\n\n<blockquote>${bodyText}</blockquote>\n\n${toCapitalSmallCaps("Confirm your transaction by clicking Confirm")}`;
        return ctx.reply(confirmMsg, {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text(makeBtn("Confirm ✅"), `auto_upi_confirm_${gwId}_${amount}`, {style: "success"}).row()
            .text(makeBtn("Cancel ❌"), "auto_upi_cancel", {style: "danger"})
        }).catch(() => { });
      }
if (state.startsWith("AUTO_BANK_AMOUNT_")) {
  let gwId = state.replace("AUTO_BANK_AMOUNT_", "");
  delete userState[userId];
  let amount = parseFloat(text);
  if (isNaN(amount) || amount <= 0) return ctx.reply(`❌ Invalid amount!`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
  let bank = await AutoBank.findOne({ gatewayId: gwId, status: "active" });
  if (!bank) return ctx.reply(`❌ Gateway not available`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
  let user = await getUser(userId);
  if (!user.bankAccNo || user.bankAccNo === "Not Set" || !user.bankIfsc || user.bankIfsc === "Not Set") return ctx.reply(`❌ Bank not linked!`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
  if (bank.minAmount > 0 && amount < bank.minAmount) return ctx.reply(`❌ Min: ₹${bank.minAmount}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
  if (bank.maxAmount > 0 && amount > bank.maxAmount) return ctx.reply(`❌ Max: ₹${bank.maxAmount}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
  if (user.balance < amount) return ctx.reply(`❌ Insufficient balance!`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
  
  let { tax: taxAmount, net: netAmount } = await calculateTax(amount);
  let bodyText = `${toCapitalSmallCaps("Amount")}: <code>${amount}</code> INR\n${toCapitalSmallCaps("Tax Deducted")}: <code>₹${taxAmount.toFixed(2)}</code>\n${toCapitalSmallCaps("You receive")}: <code>${netAmount.toFixed(2)}</code> INR\n\n🏦 ${bank.name} (Auto Bank)\nAccount : <code>${user.bankAccNo}</code>`;
  let confirmMsg = `<b>${toCapitalSmallCaps("Withdrawal Confirmation")}</b>\n\n<blockquote>${bodyText}</blockquote>\n\n${toCapitalSmallCaps("Confirm your transaction by clicking Confirm")}`;
  return ctx.reply(confirmMsg, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .text(makeBtn("Confirm ✅"), `auto_bank_confirm_${gwId}_${amount}`, {style: "success"}).row()
      .text(makeBtn("Cancel ❌"), "auto_upi_cancel", {style: "danger"})
  }).catch(() => { });
}
      if (state.startsWith("MANUAL_AMOUNT_")) {
        let method = state.replace("MANUAL_AMOUNT_", "");
        delete userState[userId];
        let amount = parseFloat(text);
        if (isNaN(amount) || amount <= 0) return ctx.reply(`❌ ${toCapitalSmallCaps("Invalid amount!")}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        let user = await getUser(userId);
        let details = user.upiId;
        if (!details || details === "Not Set" || details.includes("Not Set")) return ctx.reply(`❌ ${method.toUpperCase()} ${toCapitalSmallCaps("not linked! Please add it first.")}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        let ws = await WithdrawSettings.findOne({ method }).lean();
        let minW = ws ? ws.minAmount : 0;
        let maxW = ws ? ws.maxAmount : 0;
        if (minW > 0 && amount < minW) return ctx.reply(`❌ ${toCapitalSmallCaps("Minimum")}: ₹${minW}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (maxW > 0 && amount > maxW) return ctx.reply(`❌ ${toCapitalSmallCaps("Maximum")}: ₹${maxW}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (user.balance < amount) return ctx.reply(`❌ ${toCapitalSmallCaps("Insufficient balance!")} ${toCapitalSmallCaps("Your Balance")}: ₹${user.balance.toFixed(2)}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        
        let { tax: taxAmount, net: netAmount } = await calculateTax(amount);
        
        let methodIcon = "⚡";
        let methodLabel = "Manual UPI";
        let bodyText = `${toCapitalSmallCaps("Amount")}: <code>${amount}</code> INR\n` +
          `${toCapitalSmallCaps("Tax Deducted")}: <code>₹${taxAmount.toFixed(2)}</code>\n` +
          `${toCapitalSmallCaps("You receive")}: <code>${netAmount.toFixed(2)}</code> INR\n\n` +
          `${methodIcon} ${methodLabel} ID: <code>${details}</code>`;
        let confirmMsg = `<b>${toCapitalSmallCaps("Withdrawal Confirmation")}</b>\n\n<blockquote>${bodyText}</blockquote>\n\n${toCapitalSmallCaps("Confirm your transaction by clicking Confirm")}`;
        userState[userId] = `MANUAL_CONFIRM_${method}_${amount}`;
        return ctx.reply(confirmMsg, {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text(makeBtn("Confirm ✅"), `man_conf_yes_${method}_${amount}`, {style: "success"}).row()
            .text(makeBtn("Cancel ❌"), `man_conf_no`, {style: "danger"})
        }).catch(() => { });
      }

      if (state === "WAITING_FOR_GIFT_REDEEM") {
        delete userState[userId];
        let gift = await GiftCode.findOneAndUpdate(
          { code: text, type: "redeem", usedUsers: { $ne: userId }, $expr: { $lt: [{ $size: "$usedUsers" }, "$maxUses"] } },
          { $push: { usedUsers: userId } }, { new: true }
        );
        if (!gift) return ctx.reply(`🚫 ${toCapitalSmallCaps("Invalid or expired!")}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        let user = await getUser(userId);
        user.balance += gift.amount;
        await user.save();
        await logBalanceHistory(userId, `Gift Redeemed (${gift.code})`, gift.amount);
        return ctx.reply(`🎉 ${toCapitalSmallCaps("Gift redeemed!")} ${toCapitalSmallCaps("Added")} ₹${gift.amount}.`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
      }

      return;
    }

    if (text.startsWith("/")) return next();

    let user = await getUser(userId);
    let layout = await getCurrentKeyboardLayoutForUser(userId);
    let findKeyByName = (name) => {
      let btn = layout.find(b => b.name === name && !b.hidden);
      return btn ? btn.key : null;
    };
    let matchedKey = findKeyByName(text);

    let isAdminUser = await isAdmin(userId);
    if (matchedKey && !isAdminUser) {
      let isJoined = await checkForceJoin(ctx);
      if (!isJoined) return sendForceJoinMessage(ctx);
    }

    if (matchedKey === "btn_balance") {
      try { await sendBalancePage(ctx, false, true); } catch (err) { return ctx.reply(`❌ Error: ${err.message}`).catch(() => { }); }
      return;
    }
    else if (matchedKey === "btn_tasks") {
      try {
        let tasks = await Task.find({ isActive: { $ne: false }, isComplete: true }).sort({ createdAt: -1 }).lean();
        if (!tasks || tasks.length === 0) return ctx.reply(`${toCapitalSmallCaps("No tasks available.")}`, { parse_mode: "HTML" }).catch(() => { });
        let taskButtons = [];
        tasks.forEach(t => taskButtons.push([{ text: `${t.title} (₹${t.reward})`, callback_data: `do_task_${t.taskId}` }]));
        return ctx.reply(`<b>${toCapitalSmallCaps("Available Tasks")}</b>`, { reply_markup: await buildStyledKb(taskButtons), parse_mode: "HTML" }).catch(() => { });
      } catch (e) { return ctx.reply(`❌ ${toCapitalSmallCaps("Error loading tasks.")}`, { parse_mode: "HTML" }).catch(() => { }); }
    }
    else if (matchedKey === "btn_gift") {
      userState[userId] = "WAITING_FOR_GIFT_REDEEM";
      let giftText = await getConfig("gift_code_text", "🎁 Enter Your Gift Code:");
      let giftLink = await getConfig("gift_code_link", "");
      let kb = new InlineKeyboard();
      if (giftLink && giftLink !== "Not Set") {
        kb.url("📢 Join Channel to Claim", convertOwnerLink(giftLink)).row();
      }
      return ctx.reply(`<b>${toCapitalSmallCaps(giftText)}</b>`, { parse_mode: "HTML", reply_markup: kb }).catch(() => { });
    }
    else if (matchedKey === "btn_quickpay") {
      let qpEnabled = await getConfig("quick_pay_enabled", true);
      if (!qpEnabled) return ctx.reply(`⚠️ ${toCapitalSmallCaps("Quick Pay is currently disabled.")}`, { parse_mode: "HTML" }).catch(() => { });
      let title = `💡${toCapitalSmallCaps("Quick Pay To a Simple User Payment Send")}`;
      let openingUsername = ctx.from.username ? `@${ctx.from.username}` : "No Username";
      let adminId = await getConfig("owner_id", MAIN_OWNER_ID);
      let bodyText = `${toCapitalSmallCaps("You Can Also Use The Format Below To Process Payments For One or Multiple Users:")}\n\n${toCapitalSmallCaps("Format")} :\n<code>${userId} 5</code>     <code>${openingUsername} 5</code>\n<code>${adminId} 10</code>     <code>@username 10</code>`;
      let qpText = `${title}\n\n<blockquote>${bodyText}</blockquote>`;
      userState[userId] = "QP_WAIT_INPUT";
      let kb = new Keyboard().requestUsers(`${toCapitalSmallCaps("Select User")}`, 1, { user_is_bot: false, request_name: true, request_username: true }).row().text("❌ Cancel").resized();
      return ctx.reply(qpText, { parse_mode: "HTML", reply_markup: kb }).catch(() => { });
    }
    else if (matchedKey === "btn_payout") {
      return sendPayoutMethodPage(ctx, false);
    }
    else if (matchedKey === "btn_withdraw") {
      let withdrawEnabled = await getConfig("withdraw_enabled", true);
      if (!withdrawEnabled) {
        let isAdminU = await isAdmin(userId);
        if (!isAdminU) return ctx.reply(`⚠️ ${toCapitalSmallCaps("Withdrawals are currently disabled")}`, { parse_mode: "HTML" }).catch(() => { });
      }
      let buttons = await buildWithdrawMenu();
      if (buttons.length === 0) return ctx.reply(`<b>${toCapitalSmallCaps("Choose Withdraw Method")}</b>\n\n❌ ${toCapitalSmallCaps("No withdraw methods available.")}`, { parse_mode: "HTML" }).catch(() => { });
      return ctx.reply(`<b>${toCapitalSmallCaps("Choose Withdraw Method")}</b>`, { reply_markup: await buildStyledKb(buttons), parse_mode: "HTML" }).catch(() => { });
    }
    else {
      let gift = await GiftCode.findOneAndUpdate(
        { code: text, type: "redeem", usedUsers: { $ne: userId }, $expr: { $lt: [{ $size: "$usedUsers" }, "$maxUses"] } },
        { $push: { usedUsers: userId } }, { new: true }
      ).catch(() => null);
      if (gift) {
        user.balance += gift.amount;
        await user.save();
        await logBalanceHistory(userId, `Gift Redeemed (${gift.code})`, gift.amount);
        return ctx.reply(`🎉 ${toCapitalSmallCaps("Added")} ₹${gift.amount}!`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
      }
      return sendUnknownCommand(ctx);
    }
  } catch (e) {
    console.error("message:text error:", e.message);
  }
});
// ==================== CALLBACK QUERIES (ADMIN & USER) ====================

bot.command("admin", async (ctx) => {
  let userId = ctx.from.id;
  let disabled = await isAdminDisabled(userId);
  if (disabled) {
    let ownerId = await getConfig("owner_id", MAIN_OWNER_ID);
    let ownerUser = await User.findOne({ userId: ownerId }).lean();
    let ownerName = ownerUser ? (ownerUser.firstName || "Owner") : "Owner";
    return ctx.reply(
      `❌ <b>${toCapitalSmallCaps("ADMIN ACCESS DISABLED")}</b>\n\n${toCapitalSmallCaps("Your admin permissions have been disabled by the Owner.")}\n\n📞 ${toCapitalSmallCaps("Contact Owner")}: ${ownerName}\n🆔 ${toCapitalSmallCaps("Owner ID")}: ${ownerId}`,
      { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(`${toCapitalSmallCaps("Back to Main Menu")}`, "back_to_balance") }
    ).catch(() => { });
  }
  if (!(await isAdmin(userId))) return ctx.reply(`❌ ${toCapitalSmallCaps("Not an admin!")}`, { parse_mode: "HTML" }).catch(() => { });
  await sendAdminPanel(ctx, false);
});

async function sendAdminPanel(ctx, edit = true) {
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;

  let [userCount, activeAdmins, gatewayCount] = await Promise.all([
    User.countDocuments({}),
    BotAdmin.countDocuments({ isActive: true }),
    Gateway.countDocuments({ isActive: true })
  ]);

  let botStatus = await getConfig("bot_status", "active");
  let statusDisplay = "";
  if (botStatus === "active") statusDisplay = `✅ ${toCapitalSmallCaps("Active")}`;
  else if (botStatus === "maintenance") statusDisplay = `⚠️ ${toCapitalSmallCaps("Maintenance")}`;
  else statusDisplay = `❌ ${toCapitalSmallCaps("Disabled")}`;

  let minW = await getConfig("min_withdraw", 0);
  let maxW = await getConfig("max_withdraw", 0);
  let pChannel = await getConfig("payout_channel", null);
  if (!pChannel || pChannel === "Not Set") pChannel = "Not Set";
  let supportId = await getConfig("support_username", "Not Set");
  let quickTaxEnabled = await getConfig("quick_pay_enabled", true);
  let quickTaxPercent = await getConfig("quick_pay_tax_percent", 0);

  let panelText =
    `👑 <b>${toCapitalSmallCaps("Admin Panel")}</b>\n\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🤖 <b>${toCapitalSmallCaps("Bot Status")}:</b> ${statusDisplay}\n` +
    `💸 <b>${toCapitalSmallCaps("Min")}:</b> ₹${minW} | 💰 <b>${toCapitalSmallCaps("Max")}:</b> ₹${maxW}\n` +
    `📢 <b>${toCapitalSmallCaps("Payout")}:</b> <code>${pChannel}</code>\n` +
    `💬 <b>${toCapitalSmallCaps("Support")}:</b> <code>${supportId}</code>\n` +
    `🌐 <b>${toCapitalSmallCaps("Gateways")}:</b> ${gatewayCount} ${toCapitalSmallCaps("active")}\n` +
    `⚡ <b>${toCapitalSmallCaps("Quick Pay")}:</b> ${quickTaxEnabled ? `🟢 ON` : "🔴 OFF"} (${toCapitalSmallCaps("Tax")}: ${quickTaxPercent}%)\n` +
    `👥 <b>${toCapitalSmallCaps("Users")}:</b> ${userCount} | 👑 <b>${toCapitalSmallCaps("Admins")}:</b> ${activeAdmins}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━`;

  let freshConfig = await Config.findOne({ key: "admin_panel_layout" }).lean();
  let layout = (freshConfig && freshConfig.value) ? freshConfig.value : DEFAULT_ADMIN_PANEL_LAYOUT;
  configCache.data["admin_panel_layout"] = layout;

  let visibleLayout = layout.filter(b => !b.hidden);
  let rawButtons = [];
  let maxRow = visibleLayout.length > 0 ? Math.max(...visibleLayout.map(b => b.row)) : 0;
  for (let r = 0; r <= maxRow; r++) {
    let rowButtons = visibleLayout.filter(b => b.row === r);
    if (rowButtons.length > 0) {
      let row = rowButtons.map(btn => ({ text: btn.name, callback_data: btn.key }));
      rawButtons.push(row);
    }
  }

  let styledKb = await buildStyledKb(rawButtons);

  if (edit && ctx.callbackQuery) await ctx.editMessageText(panelText, { reply_markup: styledKb, parse_mode: "HTML" }).catch(() => { });
  else await ctx.reply(panelText, { reply_markup: styledKb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("admin", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  delete userState[ctx.from.id];
  await sendAdminPanel(ctx, true);
});

// ==================== WITHDRAWAL STEP (AUTO GATEWAY) ====================
bot.callbackQuery("adm_gateway_menu", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderWithdrawalStep(ctx);
});

async function renderWithdrawalStep(ctx) {
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let text = `🚀 <b>${toCapitalSmallCaps("Withdrawal Step")}</b>\n\n${toCapitalSmallCaps("Choose withdrawal method:")}`;
  let kb = new InlineKeyboard()
    .text(makeBtn("⚡ Aᴜᴛᴏ Gᴀᴛᴇᴡᴀʏ"), "adm_auto_gateway").row()
    .text(makeBtn("🎁 Mᴀɴᴀɢᴇ Rᴇᴅᴇᴇᴍ Cᴏᴅᴇ"), "adm_redeem").row()
    .text(makeBtn("⚡ Mᴀɴᴜᴀʟ UPI"), "adm_manual_upi").row()
    .text(makeBtn("⬅️ Bᴀᴄᴋ ᴛᴏ Aᴅᴍɪɴ Pᴀɴᴇʟ"), "admin");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("adm_auto_gateway", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let text = `⚡ <b>${toCapitalSmallCaps("Auto Gateway")}</b>\n\n${toCapitalSmallCaps("Choose gateway type:")}`;
  let kb = new InlineKeyboard()
    .text(makeBtn("⚡ Auto UPI Gateway"), "adm_gateway_list").row()
    .text(makeBtn("🏦 Auto Bank Gateway"), "adm_auto_bank").row()
    .text(makeBtn("💳 Wallet Gateway"), "adm_wallet_gateway").row()
    .text(makeBtn("⬅️ Bᴀᴄᴋ"), "adm_gateway_menu");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

// ==================== MANAGE REDEEM CODES ====================
bot.callbackQuery("adm_redeem", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderRedeemPanel(ctx);
});

async function renderRedeemPanel(ctx) {
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  
  let totalCodes = await GiftCode.countDocuments({ type: "redeem" });
  let usedCodesArr = await GiftCode.aggregate([{ $match: { type: "redeem" } }, { $group: { _id: null, totalUsed: { $sum: { $size: "$usedUsers" } } } }]);
  let usedCodes = usedCodesArr[0]?.totalUsed || 0;
  let remainingCodes = totalCodes - usedCodes;
  
  let requiredRefers = await getConfig("redeem_required_refers", 0);
  let redeemMode = await getConfig("redeem_mode", false);
  let statusText = redeemMode ? "🟢 Eɴᴀʙʟᴇᴅ" : "🔴 Dɪsᴀʙʟᴇᴅ";

  let text = `🔍 <b>Hᴇʀᴇ, Yᴏᴜ Cᴀɴ Mᴀɴᴀɢᴇ Yᴏᴜʀ Rᴇᴅᴇᴇᴍ Cᴏᴅᴇs.</b>\n\n`;
  text += `— Eᴠᴇʀʏᴛʜɪɴɢ Is Iɴ Yᴏᴜʀ Cᴏɴᴛʀᴏʟ\n\n`;
  text += `📊 Tᴏᴛᴀʟ Cᴏᴅᴇs: <b>${totalCodes}</b>\n`;
  text += `✅ Usᴇᴅ: <b>${usedCodes}</b>\n`;
  text += `⏳ Rᴇᴍᴀɪɴɪɴɢ: <b>${remainingCodes}</b>`;

  let kb = new InlineKeyboard()
    .text(makeBtn("📊 Rᴇᴅᴇᴇᴍ Cᴏᴅᴇ Sᴛᴀᴛɪsᴛɪᴄs"), "redeem_stats").row()
    .text(makeBtn("👥 Rᴇǫᴜɪʀᴇᴅ Rᴇꜰᴇʀs Fᴏʀ"), "redeem_set_refers")
    .text(makeBtn("💲 Tᴀx Fᴏʀ Rᴇᴅᴇᴇᴍ"), "redeem_set_tax").row()
    .text(makeBtn(`🔄 Rᴇᴅᴇᴇᴍ Mᴏᴅᴇ ~ ${statusText}`), "redeem_toggle_mode").row()
    .text(makeBtn("➕ Aᴅᴅ Rᴇᴅᴇᴇᴍ Cᴏᴅᴇs"), "adm_redeem_add")
    .text(makeBtn("🗑️ Rᴇᴍᴏᴠᴇ Cᴏᴅᴇ"), "adm_redeem_remove").row()
    .text(makeBtn("⬅️ Bᴀᴄᴋ"), "adm_gateway_menu");

  if (ctx.callbackQuery) await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
  else await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("redeem_toggle_mode", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let current = await getConfig("redeem_mode", false);
  await setConfig("redeem_mode", !current);
  await ctx.answerCallbackQuery({ text: !current ? "🟢 Eɴᴀʙʟᴇᴅ" : "🔴 Dɪsᴀʙʟᴇᴅ" }).catch(() => { });
  await renderRedeemPanel(ctx);
});
bot.callbackQuery("adm_gateway_list", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let gateways = await Gateway.find({}).lean();
  let text = `⚡ <b>Auto UPI Gateways</b>\n\n`;
  let kb = new InlineKeyboard().text(makeBtn("➕ Add Gateway"), "gw_add_new").row();
  for (let g of gateways) {
    let statusIcon = g.isActive ? "🟢" : "🔴";
    text += `${statusIcon} <b>${g.name}</b>\n`;
    kb.text(`${statusIcon} ${g.name}`, `gw_view_${g.name}`).row();
  }
  kb.text(makeBtn("⬅️ Back"), "adm_auto_gateway");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("gw_add_new", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "GW_WAIT_NAME_V2";
  await ctx.editMessageText(`➕ <b>Add Gateway</b>\n\nSend Gateway Name:`, { 
    parse_mode: "HTML", 
    reply_markup: new InlineKeyboard().text("Cancel", "adm_gateway_list") 
  }).catch(() => { });
});

bot.callbackQuery(/^gw_view_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  let name = ctx.callbackQuery.data.replace("gw_view_", "");
  let gw = await Gateway.findOne({ name }).lean();
  if (!gw) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let text = `⚡ <b>${gw.name}</b>\n\n🔗 URL: <code>${gw.url}</code>\n🟢 Status: ${gw.isActive ? "ON" : "OFF"}\n💰 Min: ₹${gw.minAmount}\n💰 Max: ₹${gw.maxAmount}`;
  let kb = new InlineKeyboard()
    .text(makeBtn(gw.isActive ? "🔴 Turn OFF" : "🟢 Turn ON"), `gw_toggle_${gw.name}`).row()
    .text(makeBtn("🗑️ Delete"), `gw_del_${gw.name}`).row()
    .text(makeBtn("⬅️ Back"), "adm_gateway_list");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^gw_toggle_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  let name = ctx.callbackQuery.data.replace("gw_toggle_", "");
  let gw = await Gateway.findOne({ name });
  if (gw) { gw.isActive = !gw.isActive; await gw.save(); }
  await ctx.answerCallbackQuery({ text: "Updated!" }).catch(() => { });
  await ctx.editMessageText(`✅ Status Updated`, { reply_markup: new InlineKeyboard().text("Back", "adm_gateway_list") }).catch(() => { });
});

bot.callbackQuery(/^gw_del_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  let name = ctx.callbackQuery.data.replace("gw_del_", "");
  await Gateway.deleteOne({ name });
  await ctx.answerCallbackQuery({ text: "Deleted!" }).catch(() => { });
  await ctx.editMessageText(`✅ Gateway Deleted`, { reply_markup: new InlineKeyboard().text("Back", "adm_gateway_list") }).catch(() => { });
});
bot.callbackQuery("adm_redeem_add", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "WAITING_REDEEM_ADD";
  await ctx.editMessageText(`➕ <b>Add Redeem Codes</b>\n\n📝 Send in format:\n<code>CODE AMOUNT MAX_USES</code>\n\nExample:\n<code>WELCOME50 50 100</code>\n\n💡 Type <code>AUTO 50 100</code> for auto-generation.`, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().text("Cancel", "adm_redeem")
  }).catch(() => { });
});

bot.callbackQuery("adm_redeem_remove", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "WAITING_REDEEM_REMOVE";
  await ctx.editMessageText(`🗑️ <b>Remove Redeem Codes</b>\n\n📝 Send codes to remove (one per line):\n\nExample:\n<code>WELCOME50\nBONUS100</code>`, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().text("Cancel", "adm_redeem")
  }).catch(() => { });
});

// ==================== MANUAL UPI SETTINGS ====================
bot.callbackQuery("adm_manual_upi", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderManualUpiSettings(ctx);
});

async function renderManualUpiSettings(ctx) {
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  
  let setting = await WithdrawSettings.findOne({ method: "upi" });
  if (!setting) setting = await WithdrawSettings.create({ method: "upi", isActive: true });
  
  let status = setting.isActive ? "🟢 Aᴄᴛɪᴠᴇ" : "🔴 Iɴᴀᴄᴛɪᴠᴇ";
  let taxDisplay = "Custom Rules";
  
  let text = `⚡ <b>Manual UPI Settings</b>\n\n`;
  text += `📊 Status: ${status}\n`;
  text += `💰 Min Withdraw: ₹${setting.minAmount || 0}\n`;
  text += `💰 Max Withdraw: ₹${setting.maxAmount || 0}\n`;
  text += `📊 Tax Rules: ${taxDisplay}\n`;
  text += `⏱️ Cooldown: ${setting.cooldownMinutes || 0} Min\n`;
  text += `🔢 Max Count: ${setting.maxCount || 0} Times`;

  let kb = new InlineKeyboard()
    .text(makeBtn("💰 Sᴇᴛ Mɪɴ"), "man_set_min").text(makeBtn("💰 Sᴇᴛ Mᴀx"), "man_set_max").row()
    .text(makeBtn("📊 Sᴇᴛ Tᴀx"), "man_set_tax").row()
    .text(makeBtn("⏱️ Sᴇᴛ Cᴏᴏʟᴅᴏᴡɴ"), "man_set_cooldown").row()
    .text(makeBtn(setting.isActive ? "🔴 Tᴜʀɴ OFF" : "🟢 Tᴜʀɴ ON"), "man_toggle_status").row()
    .text(makeBtn("⬅️ Bᴀᴄᴋ"), "adm_gateway_menu");

  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("man_toggle_status", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let s = await WithdrawSettings.findOne({ method: "upi" });
  if (!s) return;
  s.isActive = !s.isActive;
  await s.save();
  await ctx.answerCallbackQuery({ text: s.isActive ? "ON" : "OFF" }).catch(() => { });
  await renderManualUpiSettings(ctx);
});

bot.callbackQuery("man_set_min", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "MAN_SET_MIN";
  await ctx.editMessageText(`💰 Send new Minimum Withdraw amount:`, { reply_markup: new InlineKeyboard().text("Cancel", "adm_manual_upi") }).catch(() => { });
});

bot.callbackQuery("man_set_max", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "MAN_SET_MAX";
  await ctx.editMessageText(`💰 Send new Maximum Withdraw amount:`, { reply_markup: new InlineKeyboard().text("Cancel", "adm_manual_upi") }).catch(() => { });
});

bot.callbackQuery("man_set_tax", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  // ഇവിടെ നമ്മൾ Custom Tax Rules സിസ്റ്റം ഉപയോഗിക്കുന്നു
  await ctx.editMessageText(`📊 Send Tax Rule (Format: MIN-MAX-TAX):\nExample: <code>15-100-5</code>`, { 
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().text("Cancel", "adm_manual_upi") 
  }).catch(() => { });
});

bot.callbackQuery("man_set_cooldown", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "MAN_SET_COOLDOWN";
  await ctx.editMessageText(`⏱️ Send cooldown in minutes (0 = no cooldown):`, { reply_markup: new InlineKeyboard().text("Cancel", "adm_manual_upi") }).catch(() => { });
});

// ==================== USER UI CALLBACKS ====================
bot.callbackQuery("refresh_balance_only", async (ctx) => {
  try {
    await ctx.answerCallbackQuery({ text: "Refreshed!" }).catch(() => { });
    await sendBalancePage(ctx, true, true);
  } catch (e) { console.error("refresh_balance_only:", e.message); }
});

bot.callbackQuery("back_to_balance", async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => { });
  delete userState[ctx.from.id];
  try { await sendBalancePage(ctx, true, false); } catch (e) { }
});

bot.callbackQuery("balance_statement", async (ctx) => {
  let userId = ctx.from.id;
  await ctx.answerCallbackQuery().catch(() => { });
  
  let user = await getUser(userId);
  let history = await BalanceHistory.find({ userId }).sort({ createdAt: -1 }).lean();
  
  if (history.length === 0) {
    return ctx.editMessageText(`📒 <b>Balance Statement</b>\n\nCurrent Balance: <b>₹${user.balance.toFixed(2)}</b>\n\n📭 No transactions found.`, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("🔄 Refresh", "balance_statement").row().text("⬅️ Back", "back_to_balance")
    }).catch(() => { });
  }

  let perPage = 10;
  let totalPages = Math.ceil(history.length / perPage);
  let page = 1;
  let pageItems = history.slice(0, perPage);
  
  let text = `📒 <b>Balance Statement</b>\n\n`;
  text += `Current Balance: <b>₹${user.balance.toFixed(2)}</b>\n`;
  text += `Page ${page} of ${totalPages}\n\n`;

  pageItems.forEach((h) => {
    let icon = h.amount >= 0 ? "🟢" : "🔴";
    let sign = h.amount >= 0 ? "+" : "";
    let d = new Date(h.createdAt);
    let dateStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}, `;
    let hours = d.getHours();
    let ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12 || 12;
    dateStr += `${String(hours).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')} ${ampm}`;

    text += `${icon} ${sign}₹${Math.abs(h.amount).toFixed(2)} · ${h.action}\n`;
    text += `${dateStr}\n\n`;
  });

  let kb = new InlineKeyboard();
  if (totalPages > 1) {
    kb.row({ text: "⬅️ Previous", callback_data: `stmt_page_${page - 1}` }, { text: "Next ➡️", callback_data: `stmt_page_${page + 1}` });
  }
  kb.text("🔄 Refresh", "balance_statement").row();
  kb.text("⬅️ Back", "back_to_balance");

  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});
bot.callbackQuery(/^stmt_page_/, async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => { });
  let page = parseInt(ctx.callbackQuery.data.replace("stmt_page_", ""), 10);
  let userId = ctx.from.id;
  let user = await getUser(userId);
  let history = await BalanceHistory.find({ userId }).sort({ createdAt: -1 }).lean();
  let perPage = 10;
  let totalPages = Math.ceil(history.length / perPage);
  if (page < 1) page = 1;
  if (page > totalPages) page = totalPages;
  let start = (page - 1) * perPage;
  let pageItems = history.slice(start, start + perPage);
  let text = `📒 <b>Balance Statement</b>\n\nCurrent Balance: <b>₹${user.balance.toFixed(2)}</b>\nPage ${page} of ${totalPages}\n\n`;
  pageItems.forEach((h) => {
    let icon = h.amount >= 0 ? "🟢" : "🔴";
    let sign = h.amount >= 0 ? "+" : "";
    let d = new Date(h.createdAt);
    let dateStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}, `;
    let hours = d.getHours();
    let ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12 || 12;
    dateStr += `${String(hours).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')} ${ampm}`;
    text += `${icon} ${sign}₹${Math.abs(h.amount).toFixed(2)} · ${h.action}\n${dateStr}\n\n`;
  });
  let kb = new InlineKeyboard();
  let navRow = [];
  if (page > 1) navRow.push({ text: "⬅️ Previous", callback_data: `stmt_page_${page - 1}` });
  if (page < totalPages) navRow.push({ text: "Next ➡️", callback_data: `stmt_page_${page + 1}` });
  if (navRow.length > 0) kb.row(...navRow);
  kb.text("🔄 Refresh", "balance_statement").row();
  kb.text("⬅️ Back", "back_to_balance");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});
bot.callbackQuery("live_fund", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Loading..." }).catch(() => { });
  try {
    let users = await User.find({}).lean();
    let totalBalance = 0;
    users.forEach(u => { totalBalance += (u.balance || 0); });
    
    let liveFund = await LiveFund.findOne({ key: "main_fund" }).lean();
    let isFundActive = liveFund && liveFund.isActive;
    
    let bodyText = `💼 <b>All User Hold Balance</b>\n`;
    bodyText += `👥 Users: ${users.length}\n`;
    bodyText += `💵 Total Amount: <b>₹${totalBalance.toFixed(2)}</b>\n\n`;

    let targetPercent = 0;
    let fundDetailsText = "";

    if (isFundActive) {
      let setFund = liveFund.totalFund || 0;
      let usedFund = liveFund.usedFund || 0;
      let running = setFund - usedFund;
      
      if (setFund > 0) targetPercent = (usedFund / setFund) * 100;
      
      fundDetailsText = `💰 Set Fund: ₹${setFund.toFixed(2)}\n` +
                        `📉 Running Fund: ₹${running.toFixed(2)}</blockquote>`;
    }

    const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
    const makeBtn = (text) => `${pad}${text}${pad}`;
    
    let kb = new InlineKeyboard()
      .text(makeBtn("🔄 Rᴇꜰʀᴇsʜ"), "live_fund").row()
      .text(makeBtn("⬅️ Bᴀᴄᴋ"), "back_to_balance");

    const generateMsg = (currentPercent) => {
      let totalBlocks = 20;
      let filledBlocks = Math.round((Math.min(100, Math.max(0, currentPercent)) / 100) * totalBlocks);
      let emptyBlocks = totalBlocks - filledBlocks;
      let progressBar = `[${"█".repeat(filledBlocks)}${"░".repeat(emptyBlocks)}] ${currentPercent.toFixed(0)}%`;
      
      let finalTxt = `💰 <b>LIVE FUND REPORT</b>\n━━━━━━━━━━━━━━━━━━━━\n\n${bodyText}`;
      if (isFundActive) {
         finalTxt += `<blockquote>📊 Fund Usage:\n${progressBar}\n\n${fundDetailsText}`;
      }
      finalTxt += `\n━━━━━━━━━━━━━━━━━━━━`;
      return finalTxt;
    };

    let msg = await ctx.editMessageText(generateMsg(0), { reply_markup: kb, parse_mode: "HTML" }).catch(() => { 
      return ctx.reply(generateMsg(0), { reply_markup: kb, parse_mode: "HTML" }).catch(() => null);
    });

    let messageId = msg ? msg.message_id : (ctx.callbackQuery ? ctx.callbackQuery.message.message_id : null);
    let chatId = ctx.chat.id;

    if (isFundActive && targetPercent > 0 && messageId) {
      let steps = 10;
      let delay = 50;
      
      for (let i = 1; i <= steps; i++) {
        let progress = i / steps;
        let currentPercent = targetPercent * progress;
        await ctx.api.editMessageText(chatId, messageId, generateMsg(currentPercent), { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
        await new Promise(r => setTimeout(r, delay));
      }
      await ctx.api.editMessageText(chatId, messageId, generateMsg(targetPercent), { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
    }
  } catch (e) { console.error("Live Fund Error:", e.message); }
});

// ==================== QUICK PAY CONFIRM/CANCEL ====================
bot.callbackQuery("qp_cancel", async (ctx) => {
  let userId = ctx.from.id;
  delete userState[userId];
  if (global.quickPayCache) delete global.quickPayCache[userId];
  await ctx.answerCallbackQuery({ text: "Cancelled!" }).catch(() => { });
  
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  
  await ctx.reply("❌ Cᴀɴᴄᴇʟʟᴇᴅ", { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
  await ctx.editMessageText("❌ Cᴀɴᴄᴇʟʟᴇᴅ", { reply_markup: new InlineKeyboard().text(makeBtn("Bᴀᴄᴋ"), "back_to_balance") }).catch(() => { });
});

bot.callbackQuery("qp_confirm_multi", async (ctx) => {
  try {
    let userId = ctx.from.id;
    let cacheObj = global.quickPayCache?.[userId];
    if (!cacheObj || !cacheObj.payments || cacheObj.payments.length === 0) return ctx.answerCallbackQuery({ text: "Expired!", show_alert: true }).catch(() => { });
    
    let payments = cacheObj.payments;
    let totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);
    delete userState[userId];
    delete global.quickPayCache[userId];
    
    let sender = await getUser(userId);
    let isPrivileged = (await isAdmin(userId)) || (await isOwner(userId)) || (await isWhitelisted(userId));
    let unlimited = await getConfig("quick_pay_unlimited", true);
    let negativeAllowed = await getConfig("quick_pay_negative_balance", false);
    let skipBalance = isPrivileged && unlimited;
    
    if (!skipBalance && !negativeAllowed && sender.balance < totalAmount) return ctx.answerCallbackQuery({ text: "Insufficient!", show_alert: true }).catch(() => { });
    
    await ctx.answerCallbackQuery({ text: "Processing..." }).catch(() => { });
    
    const taxPercent = await getConfig("quick_pay_tax_percent", 0);
    let taxAmount = 0;
    if (taxPercent > 0) taxAmount = (totalAmount * taxPercent) / 100;
    
    let senderBefore = sender.balance;
    
    if (skipBalance) await logBalanceHistory(sender.userId, `Admin Quick Pay (${payments.length} payments) - Unlimited`, 0);
    else { sender.balance -= totalAmount; await sender.save(); await logBalanceHistory(sender.userId, `Quick Pay (${payments.length} payments)`, -totalAmount); }
    
    if (taxAmount > 0) {
      const ownerId = await getConfig("owner_id", MAIN_OWNER_ID);
      await User.findOneAndUpdate({ userId: ownerId }, { $inc: { balance: taxAmount } });
      await logBalanceHistory(ownerId, `Quick Pay Tax from ${userId}`, taxAmount);
    }
    
    let resultList = [];
    for (let p of payments) {
      let receiver = await User.findOne({ userId: p.receiver.userId });
      if (!receiver) continue;
      let addAmount = taxPercent > 0 ? (p.amount - (p.amount * taxPercent / 100)) : p.amount;
      let before = receiver.balance;
      receiver.balance += addAmount;
      await receiver.save();
      await logBalanceHistory(receiver.userId, `Quick Pay from ${isPrivileged ? "Admin" : sender.userId}`, addAmount);
      resultList.push({ userId: receiver.userId, firstName: receiver.firstName || "User", amount: addAmount, before, after: receiver.balance });
      try {
        let senderName = sender.firstName || "User";
        let safeName = escapeHtml(senderName);
        let senderLink = `<a href="tg://user?id=${sender.userId}">${safeName}</a>`;
        await ctx.api.sendMessage(receiver.userId, `💸 ${toCapitalSmallCaps("You Received")} ₹${addAmount.toFixed(2)} ${toCapitalSmallCaps("From")} ${senderLink}`, { parse_mode: "HTML", link_preview_options: { is_disabled: true } }).catch(() => { });
      } catch (e) { }
    }
    
    let bodyText = "";
    resultList.forEach((r, i) => { bodyText += `${i + 1}. ${r.firstName} (${r.userId})\nAmount: ₹${r.amount.toFixed(2)}\nBalance: ₹${r.after.toFixed(2)}\n\n`; });
    bodyText += `Total Users: ${resultList.length}\nTotal Sent: ₹${totalAmount.toFixed(2)}\n`;
    if (skipBalance) bodyText += `Mode: 👑 Admin/Owner (Unlimited)`;
    else bodyText += `Your Balance: ₹${senderBefore.toFixed(2)} → ₹${sender.balance.toFixed(2)}`;
    
    await ctx.reply(`✅ <b>Payment Successful</b>\n\n${bodyText}`, { parse_mode: "HTML", reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
    await ctx.deleteMessage().catch(() => { });
    
  } catch (e) { console.error("qp_confirm_multi error:", e.message); }
});

// ==================== PAYOUT METHOD ====================
bot.callbackQuery("set_upi", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  userState[ctx.from.id] = "SET_UPI_ACC";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`📝 Send your UPI ID:\n\nExample: <code>yourname@upi</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Bᴀᴄᴋ"), "btn_payout_back") }).catch(() => { });
});

bot.callbackQuery("set_wallet_number", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  userState[ctx.from.id] = "SET_WALLET_NUMBER";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`📝 Send your Wallet Number (10-12 digits):`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Bᴀᴄᴋ"), "btn_payout_back") }).catch(() => { });
});

bot.callbackQuery("btn_payout_back", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  delete userState[ctx.from.id];
  await sendPayoutMethodPage(ctx, true);
});

// ==================== WITHDRAW MENU ====================
bot.callbackQuery("back_to_withdraw", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  delete userState[ctx.from.id];
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let buttons = await buildWithdrawMenu();
  if (buttons.length === 0) {
    return ctx.editMessageText(`<b>${toCapitalSmallCaps("Choose Withdraw Method")}</b>\n\n❌ ${toCapitalSmallCaps("No withdraw methods available.")}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Bᴀᴄᴋ"), "back_to_balance") }).catch(() => { });
  }
  await ctx.editMessageText(`<b>${toCapitalSmallCaps("Choose Withdraw Method")}</b>`, { reply_markup: await buildStyledKb(buttons), parse_mode: "HTML" }).catch(() => { });
});

// ==================== GATEWAY WITHDRAWAL CONFIRM/CANCEL ====================
bot.callbackQuery("gw_conf_no", async (ctx) => {
  ctx.answerCallbackQuery({ text: "Cancelled" }).catch(() => { });
  delete userState[ctx.from.id];
  await sendBalancePage(ctx, true, false);
});

bot.callbackQuery("auto_upi_cancel", async (ctx) => {
  ctx.answerCallbackQuery({ text: "Cancelled" }).catch(() => { });
  delete userState[ctx.from.id];
  await sendBalancePage(ctx, true, false);
});

bot.callbackQuery(/^gw_conf_yes_/, async (ctx) => {
  try {
    let userId = ctx.from.id;
    let data = ctx.callbackQuery.data.replace("gw_conf_yes_", "");
    let parts = data.split("_");
    let amount = parseFloat(parts.pop());
    let gwName = parts.join("_");
    await ctx.answerCallbackQuery({ text: "Processing..." }).catch(() => { });
    delete userState[userId];
    let user = await getUser(userId);
    let gateway = await Gateway.findOne({ name: gwName, isActive: true });
    if (!gateway) return ctx.editMessageText(`❌ Gateway not found.`, { parse_mode: "HTML" }).catch(() => { });
    
    let minW = gateway.minAmount || 0;
    let maxW = gateway.maxAmount || 0;
    if (minW > 0 && amount < minW) return ctx.editMessageText(`❌ Minimum: ₹${minW}`, { parse_mode: "HTML" }).catch(() => { });
    if (maxW > 0 && amount > maxW) return ctx.editMessageText(`❌ Maximum: ₹${maxW}`, { parse_mode: "HTML" }).catch(() => { });
    if (user.balance < amount) return ctx.editMessageText(`❌ Insufficient balance!`, { parse_mode: "HTML" }).catch(() => { });
    
    let wallet = user.walletNumber || "";
    if (!wallet) return ctx.editMessageText(`❌ Number not saved!`, { parse_mode: "HTML" }).catch(() => { });

    let { tax: taxAmount, net: netAmount } = await calculateTax(amount);

    user.balance -= amount;
    user.withdrawnTotal = (user.withdrawnTotal || 0) + amount;
    await user.save();
    await logBalanceHistory(userId, `Withdrawn via ${gwName} (Bot)`, -amount);

    if (taxAmount > 0) {
      const ownerId = await getConfig("owner_id", MAIN_OWNER_ID);
      await User.findOneAndUpdate({ userId: ownerId }, { $inc: { balance: taxAmount } });
      await logBalanceHistory(ownerId, `Withdrawal Tax (${gwName})`, taxAmount);
    }

    let approvedCount = await Withdrawal.countDocuments({ userId, status: "Approved" });
    let userWithdrawalCount = approvedCount + 1;
    let withdrawalId = Math.floor(100000 + Math.random() * 900000).toString();
    let payoutChannel = await getPayoutChannel(gwName);
    let channelList = payoutChannel && payoutChannel !== "Not Set" ? [payoutChannel] : [];
    let msgId = ctx.callbackQuery.message.message_id;
    let chatId = ctx.chat.id;
    
    await ctx.editMessageText(`⏳ Processing ${buildProcessingDots(0)}`, { parse_mode: "HTML" }).catch(() => { });
    let animFrame = 1;
    const animInterval = setInterval(async () => {
      try { await ctx.api.editMessageText(chatId, msgId, `⏳ Processing ${buildProcessingDots(animFrame)}`, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
      animFrame++;
    }, 400);

    let result = await processGatewayPayout({ bot, userId, amount: netAmount, gatewayInfo: gateway, wallet, channelList, showRemainingBalance: true });
    clearInterval(animInterval);

    const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
    const makeBtn = (text) => `${pad}${text}${pad}`;

    if (result.status === "success") {
      let txnNumber = result.txnNumber || generateTxnNumber();
      let processTime = new Date();
      await Withdrawal.create({ withdrawalId, userId, userWithdrawalCount, amount, method: gwName, details: wallet, status: "Approved", isGateway: true, gatewayName: gateway.name, gatewayResponse: result.rawResponse || "", txnNumber, taxPercent: 0, taxAmount, netAmount, approvedBy: "Auto Gateway", approvedAt: processTime });
      await LiveFund.findOneAndUpdate({ key: "main_fund" }, { $inc: { usedFund: amount } }, { upsert: true });
      let serverUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
      if (!serverUrl.startsWith("http")) serverUrl = `https://${serverUrl}`;
      let receiptUrl = `${serverUrl}/receipt/${withdrawalId}`;
      let maskedWallet = halfMaskWallet(wallet);
      let successMsg = `🎁 Your Withdrawal of Rs.<code>${amount.toFixed(2)}</code> is Successfully Processed!🔥🔥\n\n` +
        `🏦 Destination ==> <code>${maskedWallet}</code>\n` +
        `🚀 Transaction ID ==> <code>${txnNumber}</code>\n\n` +
        `✅ Please Check Your ${gateway.name} Account!`;
      await ctx.api.editMessageText(chatId, msgId, successMsg, { parse_mode: "HTML", reply_markup: new InlineKeyboard().url("✅ Check Status", receiptUrl).row().text(makeBtn("Menu"), "back_to_balance") }).catch(() => { });
      let restoreKb = await buildKeyboardFromLayout(userId);
      await ctx.reply(" ", { reply_markup: restoreKb }).then(m => ctx.api.deleteMessage(chatId, m.message_id).catch(() => { })).catch(() => { });
    } else {
      user.balance += amount;
      user.withdrawnTotal = Math.max(0, (user.withdrawnTotal || 0) - amount);
      await user.save();
      await logBalanceHistory(userId, "Withdrawal Failed (Refunded)", amount);
      await ctx.api.editMessageText(chatId, msgId,
        `❌ <b>Withdrawal Failed</b>\n\nAmount: ₹${amount.toFixed(2)}\nGateway: ${gateway.name}\nReason: ${result.message || "Gateway error"}\n\n💵 Refunded: ₹${user.balance.toFixed(2)}`,
        { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Menu"), "back_to_balance") }
      ).catch(() => { });
    }
  } catch (e) { console.error("gw_conf_yes_ error:", e.message); }
});

bot.callbackQuery(/^auto_upi_confirm_/, async (ctx) => {
  try {
    let data = ctx.callbackQuery.data.replace("auto_upi_confirm_", "");
    let parts = data.split("_");
    let amount = parseFloat(parts.pop());
    let gwId = parts.join("_");
    await ctx.answerCallbackQuery({ text: "Processing..." }).catch(() => { });
    let userId = ctx.from.id;
    delete userState[userId];
    let user = await getUser(userId);
    let gw = await AutoUpi.findOne({ gatewayId: gwId, status: "active" });
    if (!gw) return ctx.editMessageText(`❌ Gateway not available`, { parse_mode: "HTML" }).catch(() => { });
    if (user.balance < amount) return ctx.editMessageText(`❌ Insufficient balance`, { parse_mode: "HTML" }).catch(() => { });
    let upiId = user.upiId;
    if (!upiId || upiId === "Not Set") return ctx.editMessageText(`❌ UPI not linked`, { parse_mode: "HTML" }).catch(() => { });

    let { tax: taxAmount, net: netAmount } = await calculateTax(amount);

    user.balance -= amount;
    user.withdrawnTotal = (user.withdrawnTotal || 0) + amount;
    await user.save();
    await logBalanceHistory(userId, `Withdrawn via ${gw.name} (Auto UPI)`, -amount);

    if (taxAmount > 0) {
      const ownerId = await getConfig("owner_id", MAIN_OWNER_ID);
      await User.findOneAndUpdate({ userId: ownerId }, { $inc: { balance: taxAmount } });
      await logBalanceHistory(ownerId, `Auto UPI Tax (${gw.name})`, taxAmount);
    }

    let msgId = ctx.callbackQuery.message.message_id;
    let chatId = ctx.chat.id;
    let animFrame = 0;
    const animInterval = setInterval(async () => {
      try { await ctx.api.editMessageText(chatId, msgId, `⏳ Processing ${buildProcessingDots(animFrame)}`, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
      animFrame++;
    }, 400);

    let result;
    try { result = await processAutoUpiPayout({ bot, userId, amount: netAmount, gateway: gw, upiId }); } 
    finally { clearInterval(animInterval); }

    const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
    const makeBtn = (text) => `${pad}${text}${pad}`;
    let maskedUPI = halfMaskUPI(upiId);

    if (result.status === "success") {
      let txnNumber = result.txnNumber || generateTxnNumber();
      let processTime = new Date();
      await Withdrawal.create({ withdrawalId: Math.floor(100000 + Math.random() * 900000).toString(), userId, amount, method: `AUTO_UPI_${gw.name}`, details: upiId, status: "Approved", isGateway: true, gatewayName: gw.name, gatewayResponse: result.rawResponse || "", txnNumber, taxPercent: 0, taxAmount, netAmount, approvedBy: "Auto UPI", approvedAt: processTime });
      await LiveFund.findOneAndUpdate({ key: "main_fund" }, { $inc: { usedFund: amount } }, { upsert: true });
      let serverUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
      if (!serverUrl.startsWith("http")) serverUrl = `https://${serverUrl}`;
      let receiptUrl = `${serverUrl}/receipt/${txnNumber}`;
      let successMsg = `🎁 Your Withdrawal of Rs.<code>${amount.toFixed(2)}</code> is Successfully Processed!🔥🔥\n\n` +
        `🏦 Destination ==> <code>${maskedUPI}</code>\n` +
        `🚀 Transaction ID ==> <code>${txnNumber}</code>\n\n` +
        `✅ Please Check Your ${gw.name} Account!`;
      await ctx.api.editMessageText(chatId, msgId, successMsg, { parse_mode: "HTML", reply_markup: new InlineKeyboard().url("✅ Check Status", receiptUrl).row().text(makeBtn("Menu"), "back_to_balance") }).catch(() => { });
      let restoreKb = await buildKeyboardFromLayout(userId);
      await ctx.reply(" ", { reply_markup: restoreKb }).then(m => ctx.api.deleteMessage(chatId, m.message_id).catch(() => { })).catch(() => { });
    } else {
      user.balance += amount;
      user.withdrawnTotal = Math.max(0, (user.withdrawnTotal || 0) - amount);
      await user.save();
      await logBalanceHistory(userId, "Auto UPI Failed (Refunded)", amount);
      await ctx.api.editMessageText(chatId, msgId,
        `❌ <b>Withdrawal Failed</b>\n\nAmount: ₹${amount.toFixed(2)}\nGateway: ${gw.name}\nReason: ${result.message || "Gateway error"}\n\n💵 Refunded: ₹${user.balance.toFixed(2)}`,
        { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Menu"), "back_to_balance") }
      ).catch(() => { });
    }
  } catch (e) { console.error("auto_upi_confirm error:", e.message); }
});

// ==================== MANUAL WITHDRAWAL ====================
bot.callbackQuery(/^wd_(upi)$/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  let userId = ctx.from.id;
  let method = ctx.callbackQuery.data.replace("wd_", "");
  let user = await getUser(userId);
  let details = user.upiId;
  
  if (!details || details === "Not Set" || details.includes("Not Set")) {
    userState[userId] = "WD_ADD_UPI";
    let kb = new Keyboard().text("Cancel").resized().oneTime();
    return ctx.reply(`UPI not linked!\n\nSend your UPI details:`, { reply_markup: kb }).catch(() => { });
  }
  userState[userId] = `MANUAL_AMOUNT_${method}`;
  let kb = new Keyboard().text("Cancel").resized().oneTime();
  await ctx.reply(`Enter Withdraw Amount`, { reply_markup: kb }).catch(() => { });
});

bot.callbackQuery(/^man_conf_yes_/, async (ctx) => {
  try {
    let data = ctx.callbackQuery.data.replace("man_conf_yes_", "");
    let parts = data.split("_");
    let amount = parseFloat(parts.pop());
    let method = parts.join("_").toLowerCase();
    await ctx.answerCallbackQuery({ text: "Processing..." }).catch(() => { });
    let userId = ctx.from.id;
    delete userState[userId];
    let user = await getUser(userId);
    let details = user.upiId;
    if (!details || details === "Not Set" || details.includes("Not Set")) return ctx.editMessageText(`❌ Method not linked!`, { parse_mode: "HTML" }).catch(() => { });
    let ws = await WithdrawSettings.findOne({ method }).lean();
    let minW = ws ? ws.minAmount : 0;
    let maxW = ws ? ws.maxAmount : 0;
    if (minW > 0 && amount < minW) return ctx.editMessageText(`❌ Minimum: ₹${minW}`, { parse_mode: "HTML" }).catch(() => { });
    if (maxW > 0 && amount > maxW) return ctx.editMessageText(`❌ Maximum: ₹${maxW}`, { parse_mode: "HTML" }).catch(() => { });
    if (user.balance < amount) return ctx.editMessageText(`❌ Insufficient balance!`, { parse_mode: "HTML" }).catch(() => { });

    let { tax: taxAmount, net: netAmount } = await calculateTax(amount);

    user.balance -= amount;
    user.withdrawnTotal = (user.withdrawnTotal || 0) + amount;
    await user.save();
    await logBalanceHistory(userId, `Withdrawn via ${method.toUpperCase()} (Bot)`, -amount);

    if (taxAmount > 0) {
      const ownerId = await getConfig("owner_id", MAIN_OWNER_ID);
      await User.findOneAndUpdate({ userId: ownerId }, { $inc: { balance: taxAmount } });
      await logBalanceHistory(ownerId, `Withdrawal Tax (${method})`, taxAmount);
    }

    let approvedCount = await Withdrawal.countDocuments({ userId, status: "Approved" });
    let userWithdrawalCount = approvedCount + 1;
    let withdrawalId = Math.floor(100000 + Math.random() * 900000).toString();
    let methodLabel = method.toUpperCase();
    let txnRef = generateTxnNumber(); // Payment Ref
    await Withdrawal.create({ withdrawalId, userId, userWithdrawalCount, amount, method: methodLabel, details, status: "Pending", isGateway: false, txnNumber: txnRef, taxPercent: 0, taxAmount, netAmount });
    
    let payoutChannel = await getPayoutChannel(method);
    if (payoutChannel && payoutChannel !== "Not Set") {
      const adminKb = new InlineKeyboard().text("Approve ✅", `wd_app_${withdrawalId}`, {style: "success"}).text("Reject ❌", `wd_rej_${withdrawalId}`, {style: "danger"});
      const userLink = `<a href="tg://user?id=${userId}"><b>${userId}</b></a>`;
      const hashTag = `<code>(#${userWithdrawalCount})</code>`;
      const methodIcon = "⚡";
      try {
        await bot.api.sendMessage(payoutChannel,
          `⚠️ <b>New ${methodLabel} Payout Request!</b> ${hashTag}\n\n` +
          `<b>User :</b> ${userLink}\n` +
          `<b>Request Amount :</b> <code><b>₹${amount.toFixed(2)}</b></code>\n` +
          `<b>Amount After Tax :</b> <code><b>₹${netAmount.toFixed(2)}</b></code>\n` +
          `${methodIcon} <b>${methodLabel} ID :</b> <code>${details}</code>\n` +
          `<b>Payment Ref :</b> <code><b>${txnRef}</b></code>\n\n` +
          `📊 <b>Status:</b> ⏳ Pending`,
          { parse_mode: "HTML", reply_markup: adminKb, disable_web_page_preview: true }
        ).catch(() => { });
      } catch (e) { console.error("Payout channel error:", e.message); }
    }
    
    const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
    const makeBtn = (text) => `${pad}${text}${pad}`;
    const methodIcon2 = "⚡";
    await ctx.editMessageText(
      `✅ <b>${toCapitalSmallCaps("Withdrawal Request Submitted!")}</b>\n\n` +
      `💰 ${toCapitalSmallCaps("Amount")}: ₹${amount.toFixed(2)}\n` +
      `${methodIcon2} ${methodLabel} ID: <code>${halfMaskDetails(methodLabel, details)}</code>\n` +
      `🆔 ${toCapitalSmallCaps("ID")}: <code>${withdrawalId}</code>\n\n` +
      `⏳ ${toCapitalSmallCaps("Waiting for admin approval...")}\n` +
      `💵 ${toCapitalSmallCaps("New Balance")}: ₹${user.balance.toFixed(2)}`,
      { parse_mode: "HTML" }
    ).catch(() => { });
    let restoreKb = await buildKeyboardFromLayout(userId);
    await ctx.reply(" ", { reply_markup: restoreKb }).then(m => ctx.api.deleteMessage(ctx.chat.id, m.message_id).catch(() => { })).catch(() => { });
  } catch (e) { console.error("man_conf_yes error:", e.message); }
});

bot.callbackQuery("man_conf_no", async (ctx) => {
  ctx.answerCallbackQuery({ text: "Cancelled" }).catch(() => { });
  delete userState[ctx.from.id];
  await sendBalancePage(ctx, true, false);
});
// ==================== QUICK PAY - USERS SHARED (SELECT USER) ====================
bot.on("message:users_shared", async (ctx) => {
  let userId = ctx.from.id;
  let state = userState[userId];
  if (state !== "QP_WAIT_INPUT") return;
  
  let shared = ctx.message.users_shared;
  if (!shared || !shared.users || shared.users.length === 0) return;
  
  let targetId = shared.users[0].user_id;
  let dbUser = await User.findOne({ userId: targetId }).lean();
  if (!dbUser) return ctx.reply(`${toCapitalSmallCaps("User not found in bot!")}\n\n${toCapitalSmallCaps("Ask them to start the bot.")}`, { parse_mode: "HTML" }).catch(() => { });
  if (targetId === userId) return ctx.reply(`❌ ${toCapitalSmallCaps("Cannot pay yourself")}`, { parse_mode: "HTML" }).catch(() => { });
  
  userState[userId] = `QP_AMOUNT_${targetId}`;
  let bodyText = `${toCapitalSmallCaps("Name")}: ${dbUser.firstName || "User"}\n${toCapitalSmallCaps("User ID")}: ${targetId}\n${toCapitalSmallCaps("Username")}: ${dbUser.username ? "@" + dbUser.username : "None"}`;
  await ctx.reply(`<b>${toCapitalSmallCaps("User Selected")}</b>\n\n<blockquote>${bodyText}</blockquote>\n\n${toCapitalSmallCaps("Enter Amount:")}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(`${toCapitalSmallCaps("Cancel")} ❌`, "qp_cancel", {style: "danger"}) }).catch(() => { });
});

// ==================== MANAGE TASKS (Admin) ====================
async function renderTaskManager(ctx) {
  const pad = "\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let tasks = await Task.find({ isComplete: true }).sort({ createdAt: -1 }).lean();
  let text = `💡 <b>Here You Can Manage Your Tasks</b>\n\nSelect a task to view, edit, or delete it.`;
  let kb = new InlineKeyboard();
  if (tasks.length === 0) kb.text(makeBtn("No Tasks"), "noop").row();
  else {
    for (let t of tasks) {
      let shortName = t.title.length > 12 ? t.title.substring(0, 12) + ".." : t.title;
      let statusIcon = t.isActive !== false ? "🟢" : "🔴";
      kb.text(`📄 ${shortName}`, `view_task_${t.taskId}`).text("✏️", `edit_task_${t.taskId}`).text("🗑️", `del_task_${t.taskId}`).text(statusIcon, `toggle_task_${t.taskId}`).row();
    }
  }
  kb.text(makeBtn("➕ Add New Task"), "adm_create_task").text(makeBtn("Search Task"), "adm_search_task").row();
  kb.text(makeBtn("➕ Add Channel For Task Alert"), "adm_task_alert_channel").row();
  kb.text(makeBtn("⬅️ Back"), "admin");
  if (ctx.callbackQuery) await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
  else await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("adm_tasks_manager", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderTaskManager(ctx);
});

bot.callbackQuery(/^view_task_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let tId = ctx.callbackQuery.data.replace("view_task_", "");
  let task = await Task.findOne({ taskId: tId }).lean();
  if (!task) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let bodyText = `Task ID: ${task.taskId}\nName: ${task.title}\nReward: ₹${task.reward}\nLink: ${task.link}\nType: ${task.taskType || "photo"}\nAlert Channel: ${task.alertChannel || "Not Set"}\nStatus: ${task.isActive !== false ? "🟢 ON" : "🔴 OFF"}\nCompleted: ${task.completedUsers.length} users`;
  if (task.expiresAt) bodyText += `\nExpires: ${formatDateTime(task.expiresAt)}`;
  let kb = new InlineKeyboard()
    .text(makeBtn("Edit Title"), `task_edit_title_${task.taskId}`).row()
    .text(makeBtn("Edit Reward"), `task_edit_reward_${task.taskId}`).row()
    .text(makeBtn("Edit Link"), `task_edit_link_${task.taskId}`).row()
    .text(makeBtn("Edit Alert Channel"), `task_edit_channel_${task.taskId}`).row()
    .text(makeBtn(`Type: ${(task.taskType || "photo").toUpperCase()}`), `task_edit_type_${task.taskId}`).row()
    .text(makeBtn("Delete Task"), `del_task_${task.taskId}`).row()
    .text(makeBtn("Back"), "adm_tasks_manager");
  await ctx.editMessageText(`<b>Task Details</b>\n\n<blockquote>${bodyText}</blockquote>`, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_create_task", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let newTaskId = "T" + Date.now().toString().slice(-10);
  global.taskCreation = global.taskCreation || {};
  global.taskCreation[ctx.from.id] = { taskId: newTaskId, title: null, reward: null, link: null, description: null, expiryMinutes: null };
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Task ID Auto-Generated</b>\n\n<code>${newTaskId}</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Create Task"), "task_create_start").row().text(makeBtn("Back"), "adm_tasks_manager") }).catch(() => { });
});

bot.callbackQuery("task_create_start", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderCreateTaskPanel(ctx);
});

async function renderCreateTaskPanel(ctx) {
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let temp = global.taskCreation?.[ctx.from.id];
  if (!temp) return ctx.answerCallbackQuery({ text: "Session expired", show_alert: true }).catch(() => { });
  let titleStatus = temp.title ? "✅" : "—";
  let rewardStatus = temp.reward ? "✅" : "—";
  let linkStatus = temp.link ? "✅" : "—";
  let descStatus = temp.description ? "✅" : "—";
  let timeStatus = temp.expiryMinutes ? "✅" : "—";
  let bodyText = `Task ID: <code>${temp.taskId}</code>\n\nTask Name: ${temp.title || "Not Set"}    ${titleStatus}\nReward: ${temp.reward ? `₹${temp.reward}` : "Not Set"}    ${rewardStatus}\nLink: ${temp.link || "Not Set"}    ${linkStatus}\nDescription: ${temp.description || "Not Set"}    ${descStatus}\nTime Limit: ${temp.expiryMinutes ? formatMinutes(temp.expiryMinutes) : "Not Set"}    ${timeStatus}`;
  let text = `<b>Create New Task</b>\n\n<blockquote>${bodyText}</blockquote>`;
  let kb = new InlineKeyboard()
    .text(makeBtn("Task Name"), "task_field_name").row()
    .text(makeBtn("Reward"), "task_field_reward").row()
    .text(makeBtn("Link"), "task_field_link").row()
    .text(makeBtn("Description"), "task_field_desc").row()
    .text(makeBtn("Time Limit"), "task_field_timelimit").row()
    .text(makeBtn("Generate"), "task_field_submit").row()
    .text(makeBtn("Back"), "adm_tasks_manager");
  if (ctx.callbackQuery) await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
  else await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

// ==================== BROADCAST (Admin) ====================
bot.callbackQuery("adm_broadcast", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "BROADCAST_WAIT_MSG";
  global.broadcastCache = global.broadcastCache || {};
  delete global.broadcastCache[ctx.from.id];
  await renderBroadcastPage(ctx);
});

async function renderBroadcastPage(ctx) {
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let broadcasts = await Broadcast.find({ createdAt: { $gte: cutoff }, status: "Completed" }).sort({ createdAt: -1 }).limit(15).lean();
  let text = `📢 <b>Broadcast Setup</b>\n\n<b>Step 1 — Send Your Message</b>\nWrite your message just like a normal Telegram chat.\n\n<b>Step 2 — Choose a Send Mode</b>\n🚀 Direct Mode — Clean message\n🔄 Forward Mode — Shows Forwarded tag\n\n👉 <b>Now, send your message below</b> 👇`;
  let kb = new InlineKeyboard();
  for (let b of broadcasts) {
    let preview = getBroadcastPreview(b);
    let timeAgo = formatTimeAgo(b.createdAt);
    let label = `${preview} — ${timeAgo}`;
    if (label.length > 40) label = label.substring(0, 38) + "..";
    kb.text(label, `bc_view_${b.broadcastId}`).row();
  }
  kb.text(makeBtn("Back"), "admin");
  if (ctx.callbackQuery) await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
  else await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

function getBroadcastPreview(b) {
  if (b.messageType === "text") {
    let content = (b.content || "").replace(/<[^>]*>/g, "").trim();
    if (!content) return "📢 Text";
    return content.length > 25 ? content.substring(0, 25) + "..." : content;
  }
  let icons = { photo: "📸 Photo", video: "🎬 Video", audio: "🎵 Audio", document: "📄 Document", sticker: "🎨 Sticker", voice: "🎤 Voice", animation: "🎬 GIF", forward: "🔄 Forward" };
  return icons[b.messageType] || "📢 Broadcast";
}

async function renderBroadcastConfirm(ctx, cacheObj) {
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let mode = cacheObj.mode || "direct";
  let modeIcon = mode === "direct" ? "🚀" : "🔄";
  let modeText = mode === "direct" ? "DIRECT MODE" : "FORWARD MODE";
  let buttonCount = 0;
  if (cacheObj.buttonRows) buttonCount = cacheObj.buttonRows.reduce((s, r) => s + r.length, 0);
  let buttonText = buttonCount > 0 ? `✅ ${buttonCount} Buttons` : `❌ No Buttons`;
  let typeText = (cacheObj.type || "text").toUpperCase();
  let text = `⚠️ <b>Confirm Broadcast</b>\n\n<b>Type:</b> ${typeText}\n<b>Mode:</b> ${modeIcon} <b>${modeText}</b>\n<b>Buttons:</b> ${buttonText}\n\n<b>Do you want to send this message to all users?</b>`;
  let directBtn = mode === "direct" ? `✅ Direct Mode` : `Direct Mode`;
  let forwardBtn = mode === "forward" ? `✅ Forward Mode` : `Forward Mode`;
  let kb = new InlineKeyboard()
    .text(directBtn, "broadcast_mode_direct")
    .text(forwardBtn, "broadcast_mode_forward").row()
    .text(makeBtn("Add Buttons"), "broadcast_add_buttons").row()
    .text(makeBtn("Confirm & Send"), "broadcast_confirm_send", {style: "success"})
    .text(makeBtn("Cancel"), "broadcast_cancel", {style: "danger"}).row()
    .text(makeBtn("Back"), "adm_broadcast");
  if (ctx.callbackQuery) await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
  else await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("broadcast_mode_direct", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let userId = ctx.from.id;
  if (!global.broadcastCache?.[userId]) return ctx.answerCallbackQuery({ text: "Expired!", show_alert: true }).catch(() => { });
  global.broadcastCache[userId].mode = "direct";
  await ctx.answerCallbackQuery({ text: "🚀 Direct Mode" }).catch(() => { });
  await renderBroadcastConfirm(ctx, global.broadcastCache[userId]);
});

bot.callbackQuery("broadcast_mode_forward", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let userId = ctx.from.id;
  if (!global.broadcastCache?.[userId]) return ctx.answerCallbackQuery({ text: "Expired!", show_alert: true }).catch(() => { });
  global.broadcastCache[userId].mode = "forward";
  await ctx.answerCallbackQuery({ text: "🔄 Forward Mode" }).catch(() => { });
  await renderBroadcastConfirm(ctx, global.broadcastCache[userId]);
});

bot.callbackQuery("broadcast_add_buttons", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "BROADCAST_ADD_BUTTONS";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let text = `⌨️ <b>Add Inline Buttons</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n🟢 <b>Basic Format (One Button)</b>\n<code>Button Text - https://example.com</code>\n\n🟢 <b>Two Buttons In Same Row</b>\n<code>Join - https://t.me/A && Support - https://t.me/B</code>`;
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "broadcast_confirm_back") }).catch(() => { });
});

bot.callbackQuery("broadcast_confirm_back", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let userId = ctx.from.id;
  let cacheObj = global.broadcastCache?.[userId];
  if (!cacheObj) return ctx.answerCallbackQuery({ text: "Expired!", show_alert: true }).catch(() => { });
  await renderBroadcastConfirm(ctx, cacheObj);
});

bot.callbackQuery("broadcast_cancel", async (ctx) => {
  let userId = ctx.from.id;
  delete userState[userId];
  if (global.broadcastCache) delete global.broadcastCache[userId];
  await ctx.answerCallbackQuery({ text: "❌ Cancelled" }).catch(() => { });
  await renderBroadcastPage(ctx);
});

bot.callbackQuery("broadcast_confirm_send", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let userId = ctx.from.id;
  let cacheObj = global.broadcastCache?.[userId];
  if (!cacheObj) return ctx.answerCallbackQuery({ text: "Expired!", show_alert: true }).catch(() => { });
  if (cacheObj.confirmed) return ctx.answerCallbackQuery({ text: "Already confirmed!", show_alert: true }).catch(() => { });
  cacheObj.confirmed = true;
  let mode = cacheObj.mode || "direct";
  let modeIcon = mode === "direct" ? "🚀" : "🔄";
  let modeText = mode === "direct" ? "DIRECT MODE" : "FORWARD MODE";
  delete userState[userId];
  delete global.broadcastCache[userId];
  await ctx.answerCallbackQuery({ text: "🚀 Broadcasting..." }).catch(() => { });
  let totalUsers = await User.countDocuments({});
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`📢 <b>Broadcasting...</b>\n\n📢 <b>Mode:</b> ${modeIcon} ${modeText}\n👥 <b>Total Users:</b> ${totalUsers}\n\n⏳ Starting...`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back to Admin"), "admin") }).catch(() => { });
  setImmediate(async () => { await runBroadcast(userId, ctx, cacheObj, totalUsers); });
});
async function runBroadcast(adminId, ctx, cacheObj, totalUsers) {
  try {
    let startTime = Date.now();
    let allUsers = await User.find({}).lean();
    let total = allUsers.length;
    let sent = 0, failed = 0, processed = 0;
    let mode = cacheObj.mode || "direct";
    let modeIcon = mode === "direct" ? "🚀" : "🔄";
    let modeText = mode === "direct" ? "DIRECT MODE" : "FORWARD MODE";
    
    let inlineKb = null;
    if (cacheObj.buttonRows && cacheObj.buttonRows.length > 0) {
      inlineKb = buildInlineKeyboardFromRows(cacheObj.buttonRows);
    }
    
    let statusMsg;
    try {
      statusMsg = await bot.api.sendMessage(adminId, buildStatusMessage({ running: true, modeIcon, modeText, processed: 0, total, success: 0, failed: 0, speed: 0 }), { parse_mode: "HTML" });
    } catch (e) { }
    
    let lastUpdate = Date.now();
    const UPDATE_INTERVAL = 1500;
    
    for (let u of allUsers) {
      try {
        let sendOpts = { parse_mode: "HTML" };
        if (inlineKb) sendOpts.reply_markup = inlineKb;
        
        if (mode === "forward" && cacheObj.fromChatId && cacheObj.fromMessageId) {
          await bot.api.forwardMessage(u.userId, cacheObj.fromChatId, cacheObj.fromMessageId).catch(() => { throw new Error("fwd"); });
        } else {
          if (cacheObj.type === "text") await bot.api.sendMessage(u.userId, cacheObj.content, sendOpts).catch(() => { throw new Error("txt"); });
          else if (cacheObj.type === "photo") await bot.api.sendPhoto(u.userId, cacheObj.fileId, { ...sendOpts, caption: cacheObj.caption || "" }).catch(() => { throw new Error("ph"); });
          else if (cacheObj.type === "video") await bot.api.sendVideo(u.userId, cacheObj.fileId, { ...sendOpts, caption: cacheObj.caption || "" }).catch(() => { throw new Error("v"); });
          else if (cacheObj.type === "audio") await bot.api.sendAudio(u.userId, cacheObj.fileId, { ...sendOpts, caption: cacheObj.caption || "" }).catch(() => { throw new Error("a"); });
          else if (cacheObj.type === "document") await bot.api.sendDocument(u.userId, cacheObj.fileId, { ...sendOpts, caption: cacheObj.caption || "" }).catch(() => { throw new Error("d"); });
          else if (cacheObj.type === "sticker") await bot.api.sendSticker(u.userId, cacheObj.fileId, inlineKb ? { reply_markup: inlineKb } : {}).catch(() => { throw new Error("s"); });
          else if (cacheObj.type === "animation") await bot.api.sendAnimation(u.userId, cacheObj.fileId, { ...sendOpts, caption: cacheObj.caption || "" }).catch(() => { throw new Error("an"); });
          else if (cacheObj.type === "voice") await bot.api.sendVoice(u.userId, cacheObj.fileId, { ...sendOpts, caption: cacheObj.caption || "" }).catch(() => { throw new Error("vo"); });
        }
        sent++;
      } catch (e) { failed++; }
      processed++;
      let now = Date.now();
      if (now - lastUpdate > UPDATE_INTERVAL && statusMsg) {
        let elapsed = (now - startTime) / 1000;
        let speed = elapsed > 0 ? processed / elapsed : 0;
        try { await bot.api.editMessageText(adminId, statusMsg.message_id, buildStatusMessage({ running: true, modeIcon, modeText, processed, total, success: sent, failed, speed }), { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
        lastUpdate = now;
      }
      await new Promise(r => setTimeout(r, 40));
    }
    
    let totalTime = (Date.now() - startTime) / 1000;
    let avgSpeed = totalTime > 0 ? total / totalTime : 0;
    let broadcastId = Math.floor(100000 + Math.random() * 900000).toString();
    
    await Broadcast.create({ broadcastId, adminId, adminName: "Admin", messageType: cacheObj.type || "text", content: cacheObj.content || cacheObj.caption || "", fileId: cacheObj.fileId || "", sentCount: sent, failedCount: failed, totalCount: total, timeTaken: parseFloat(totalTime.toFixed(1)), status: "Completed" });
    
    if (statusMsg) {
      try { await bot.api.editMessageText(adminId, statusMsg.message_id, buildStatusMessage({ running: false, modeIcon, modeText, processed: total, total, success: sent, failed, speed: avgSpeed }), { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(`⬅️ Back`, "admin") }).catch(() => { }); } catch (e) { }
    }
  } catch (e) { console.error("runBroadcast error:", e.message); }
}

function buildStatusMessage({ running = true, modeIcon = "🚀", modeText = "DIRECT MODE", processed = 0, total = 0, success = 0, failed = 0, speed = 0 }) {
  let percent = total > 0 ? (processed / total) * 100 : 0;
  let bar = makeProgressBar(percent);
  let title = running ? `🚀 <b>Broadcast Running...</b>` : `🚀 <b>Broadcast Completed!</b>`;
  return `${title}\n\n📢 <b>Mode:</b> ${modeIcon} ${modeText}\n📊 <b>Progress:</b> ${percent.toFixed(1)}%\n${bar}\n\n👥 <b>Total Users:</b> ${total}\n✅ <b>Total Success:</b> ${success}\n❌ <b>Total Failed:</b> ${failed}\n⚡ <b>Speed:</b> ${speed.toFixed(1)} users/sec\n📈 <b>Processed:</b> ${processed} / ${total}`;
}

// ==================== CUSTOMIZE THEME & BUTTON COLORS ====================
bot.callbackQuery("adm_customize_theme", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let text = `<b>Customize Your Theme</b>\n\n👇 Choose what to customize:`;
  let kb = new InlineKeyboard()
    .text(makeBtn("Admin Panel Customizing"), "adm_panel_custom").row()
    .text(makeBtn("Keyboard Buttons Customizing"), "adm_keyboard_custom").row()
    .text(makeBtn("Inline Button Colors"), "adm_btn_colors").row()
    .text(makeBtn("Font Editing"), "adm_font_edit").row()
    .text(makeBtn("Edit Unknown Command"), "adm_unknown_cmd").row()
    .text(makeBtn("Edit Balance Text"), "adm_edit_balance_text").row()
    .text(makeBtn("Start Command Edit"), "adm_start_edit").row()
    .text(makeBtn("Customer Support"), "adm_support").row()
    .text(makeBtn("Back to Admin"), "admin");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_btn_colors", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;

  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;

  let text = `🎨 <b>Inline Button Customizing</b>\n\n👇 Choose a category:`;
  let kb = new InlineKeyboard()
    .text(makeBtn("👤 User Pages"), "btn_color_user").text(makeBtn("👑 Admin Pages"), "btn_color_admin").row()
    .text(makeBtn("🔄 Reset to Default"), "btn_color_reset").row()
    .text(makeBtn("⬅️ Back"), "adm_customize_theme");

  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("btn_color_user", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;

  let text = `👤 <b>User Pages Buttons</b>\n\n👇 Select a button:`;
  let kb = new InlineKeyboard()
    .text(makeBtn("💰 Deposit"), "btncol_deposit").row()
    .text(makeBtn("📊 Statement"), "btncol_statement").row()
    .text(makeBtn("💰 Live Fund"), "btncol_livefund").row()
    .text(makeBtn("🔄 Refresh"), "btncol_refresh").row()
    .text(makeBtn("⬅️ Back"), "adm_btn_colors");

  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^btncol_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  let btnName = ctx.callbackQuery.data.replace("btncol_", "");
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;

  let text = `🎨 <b>Select Color for: ${btnName}</b>`;
  let kb = new InlineKeyboard()
    .text("🟦 Primary (Blue)", `setcol_${btnName}_primary`).row()
    .text("🟩 Success (Green)", `setcol_${btnName}_success`).row()
    .text("🟥 Danger (Red)", `setcol_${btnName}_danger`).row()
    .text("⚪ Default (Remove)", `setcol_${btnName}_none`).row()
    .text(makeBtn("⬅️ Back"), "btn_color_user");

  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^setcol_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  let parts = ctx.callbackQuery.data.replace("setcol_", "").split("_");
  let color = parts.pop();
  let btnName = parts.join("_");

  let colors = await getConfig("button_colors", {});
  if (color === "none") delete colors[btnName];
  else colors[btnName] = color;
  
  await setConfig("button_colors", colors);
  await ctx.answerCallbackQuery({ text: "✅ Saved!" }).catch(() => { });
  await ctx.editMessageText(`✅ <b>Color Updated!</b>`, { reply_markup: new InlineKeyboard().text("⬅️ Back", "btn_color_user"), parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("btn_color_reset", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  await setConfig("button_colors", {});
  await ctx.answerCallbackQuery({ text: "✅ Reset to Default!" }).catch(() => { });
  await ctx.editMessageText(`🎨 <b>Inline Button Customizing</b>\n\nColors have been reset to default.`, { reply_markup: new InlineKeyboard().text("⬅️ Back", "adm_customize_theme"), parse_mode: "HTML" }).catch(() => { });
});

// ==================== FONT EDITING ====================
bot.callbackQuery("adm_font_edit", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderFontEditPage(ctx);
});

async function renderFontEditPage(ctx) {
  const pad = "\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let currentFont = await getConfig("bot_font", "normal");
  let text = `<b>Font Editing</b>\n\n📊 Current Font: <b>${currentFont}</b>\n\n👇 Select your font style:\n\n<i>Preview: Admin Panel</i>`;
  let kb = new InlineKeyboard();
  let previews = {
    "normal": "Admin Panel",
    "capital_smallcaps": "Aᴅᴍɪɴ Pᴀɴᴇʟ"
  };
  for (let opt of FONT_OPTIONS) {
    let check = currentFont === opt.key ? "✅" : "";
    kb.text(`${opt.name} ${check} — ${previews[opt.key]}`, `font_set_${opt.key}`).row();
  }
  kb.text(makeBtn("Back to Theme"), "adm_customize_theme");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery(/^font_set_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let fontKey = ctx.callbackQuery.data.replace("font_set_", "");
  await setConfig("bot_font", fontKey);
  configCache.data["bot_font"] = fontKey;
  await ctx.answerCallbackQuery({ text: `Font: ${fontKey}` }).catch(() => { });
  await renderFontEditPage(ctx);
});

// ==================== ERROR HANDLER & BOT START ====================
async function handleAdminTextInput(ctx, text, userId, state) {
  try {
    const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
    const makeBtn = (text) => `${pad}${text}${pad}`;
    if (!(await isAdmin(userId))) return false;

    if (state === "ADD_TAX_RULE") {
      delete userState[userId];
      let parts = text.split("-");
      if (parts.length !== 3) return ctx.reply(`❌ Invalid format! Use: <code>MIN-MAX-TAX</code>`, { parse_mode: "HTML" }).catch(() => { });
      let min = parseFloat(parts[0]); let max = parseFloat(parts[1]); let tax = parseFloat(parts[2]);
      if (isNaN(min) || isNaN(max) || isNaN(tax)) return ctx.reply(`❌ Invalid numbers!`).catch(() => { });
      let rules = await getConfig("tax_rules", []);
      rules.push({ min, max, tax });
      await setConfig("tax_rules", rules);
      await ctx.reply(`✅ Tax Rule Added: ₹${min} - ₹${max} = ₹${tax}`, { reply_markup: new InlineKeyboard().text("Back", "adm_set_wd_tax") }).catch(() => { });
      return true;
    }
    if (state === "MAN_SET_MIN") {
      delete userState[userId];
      let amt = parseFloat(text);
      if (isNaN(amt) || amt < 0) return ctx.reply("❌ Invalid!").catch(() => { });
      await WithdrawSettings.updateOne({ method: "upi" }, { minAmount: amt });
      await ctx.reply(`✅ Min updated to ₹${amt}`, { reply_markup: new InlineKeyboard().text("Back", "adm_manual_upi") }).catch(() => { });
      return true;
    }
    if (state === "MAN_SET_MAX") {
      delete userState[userId];
      let amt = parseFloat(text);
      if (isNaN(amt) || amt < 0) return ctx.reply("❌ Invalid!").catch(() => { });
      await WithdrawSettings.updateOne({ method: "upi" }, { maxAmount: amt });
      await ctx.reply(`✅ Max updated to ₹${amt}`, { reply_markup: new InlineKeyboard().text("Back", "adm_manual_upi") }).catch(() => { });
      return true;
    }
    if (state === "MAN_SET_COOLDOWN") {
      delete userState[userId];
      let amt = parseFloat(text);
      if (isNaN(amt) || amt < 0) return ctx.reply("❌ Invalid!").catch(() => { });
      await WithdrawSettings.updateOne({ method: "upi" }, { cooldownMinutes: amt });
      await ctx.reply(`✅ Cooldown updated to ${amt} mins`, { reply_markup: new InlineKeyboard().text("Back", "adm_manual_upi") }).catch(() => { });
      return true;
    }
    if (state === "WAITING_REDEEM_ADD") {
      delete userState[userId];
      let lines = text.trim().split("\n").filter(l => l.trim() !== "");
      let added = 0;
      for (let line of lines) {
        let parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          let code = parts[0].toUpperCase();
          let amount = parseFloat(parts[1]);
          let maxUses = parts[2] ? parseInt(parts[2]) : 1;
          if (!isNaN(amount) && amount > 0) { await GiftCode.create({ code, amount, maxUses: isNaN(maxUses) ? 1 : maxUses, type: "redeem", usedUsers: [] }); added++; }
        }
      }
      await ctx.reply(`✅ Successfully added ${added} code(s)!`, { reply_markup: new InlineKeyboard().text("Back", "adm_redeem") }).catch(() => { });
      return true;
    }
    if (state === "WAITING_REDEEM_REMOVE") {
      delete userState[userId];
      let codes = text.trim().split("\n").map(c => c.trim().toUpperCase()).filter(c => c !== "");
      let removed = 0;
      for (let code of codes) { let res = await GiftCode.deleteOne({ code, type: "redeem" }); if (res.deletedCount > 0) removed++; }
      await ctx.reply(`✅ Successfully removed ${removed} code(s)!`, { reply_markup: new InlineKeyboard().text("Back", "adm_redeem") }).catch(() => { });
      return true;
    }
    if (state.startsWith("GW_WAIT_URL_V2_")) {
      let gwName = state.replace("GW_WAIT_URL_V2_", "");
      if (!text.startsWith("http://") && !text.startsWith("https://")) return ctx.reply(`❌ Invalid URL!`).catch(() => { });
      delete userState[userId];
      await Gateway.create({ name: gwName, url: text.trim(), url_template: text.trim(), isActive: true, minAmount: 0, maxAmount: 0, taxPercent: 0, createdBy: userId });
      await ctx.reply(`✅ Gateway Created!\n\n📛 ${gwName}\n🟢 ON`, { reply_markup: new InlineKeyboard().text("Back", "adm_gateway_list") }).catch(() => { });
      return true;
    }
    return false;
  } catch (e) { console.error("handleAdminTextInput error:", e.message); return false; }
}
bot.catch(async (err) => {
  console.error("❌ Bot Error:", err.message);
  try {
    let ctx = err.ctx;
    let userId = ctx?.from?.id || 0;
    let firstName = ctx?.from?.first_name || "Unknown";
    let action = ctx?.update?.message?.text || (ctx?.callbackQuery?.data ? `Callback: ${ctx.callbackQuery.data}` : "Unknown Action");

    await BugLog.create({
      userId,
      firstName,
      errorMessage: err.message || String(err),
      errorStack: err.stack || "",
      action
    });
  } catch (e) { console.error("Failed to save bug log:", e.message); }
});

let botRetryCount = 0;
const MAX_BOT_RETRIES = 15;

async function startBotSafe() {
  try {
    await bot.start({
      onStart: (info) => {
        console.log(`🚀 Bot @${info.username} running!`);
        botRetryCount = 0;
      }
    });
  } catch (err) {
    const errMsg = err?.message || String(err);
    console.error("❌ Bot start error:", errMsg);
    if (errMsg.includes("409") || errMsg.includes("Conflict")) {
      botRetryCount++;
      if (botRetryCount <= MAX_BOT_RETRIES) {
        console.log(`⚠️ 409 Conflict. Retry ${botRetryCount}/${MAX_BOT_RETRIES} in 5s...`);
        await new Promise(r => setTimeout(r, 5000));
        return startBotSafe();
      }
    }
    console.error("❌ Bot failed after max retries.");
    process.exit(1);
  }
}

process.on("unhandledRejection", (reason) => { console.error("⚠️ Unhandled Rejection:", reason); });
process.on("uncaughtException", (err) => { console.error("⚠️ Uncaught Exception:", err.message); });

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log("🍃 MongoDB Connected!");
    try {
      await User.collection.createIndex({ userId: 1 }, { unique: true });
      await User.collection.createIndex({ balance: -1 });
      await Withdrawal.collection.createIndex({ userId: 1, status: 1 });
      await BalanceHistory.collection.createIndex({ userId: 1, createdAt: -1 });
      await Config.collection.createIndex({ key: 1 }, { unique: true });
      await Channel.collection.createIndex({ channelId: 1 }, { unique: true });
      await AutoUpi.collection.createIndex({ gatewayId: 1 }, { unique: true });
      console.log("⚡ MongoDB indexes created!");
    } catch (e) { console.log("⚠️ Index creation:", e.message); }

    await preloadAllConfigs();
    await getConfig("min_withdraw", 0);
    await getConfig("max_withdraw", 0);
    await getConfig("tax_rules", []);
    await getConfig("balance_welcome_text", DEFAULT_BALANCE_TEXT.welcome);
    await getConfig("balance_footer_text", DEFAULT_BALANCE_TEXT.footer);
    await getConfig("start_title_text", DEFAULT_START_TEXT.title);
    await getConfig("start_link_prefix", DEFAULT_START_TEXT.linkPrefix);
    await getConfig("start_link_clickable", DEFAULT_START_TEXT.linkClickable);
    await getConfig("admin_panel_layout", DEFAULT_ADMIN_PANEL_LAYOUT);
    await getConfig("keyboard_layout", DEFAULT_KEYBOARD_LAYOUT);
    await getConfig("welcome_channel_link", "https://t.me/yourchannel");
    await getConfig("bot_active", true);
    await getConfig("bot_status", "active");
    await getConfig("withdraw_enabled", true);
    await getConfig("quick_pay_enabled", true);
    await getConfig("quick_pay_unlimited", true);
    await getConfig("quick_pay_negative_balance", false);
    await getConfig("quick_pay_tax_percent", 0);
    await getConfig("quick_pay_whitelist", []);
    await getConfig("new_user_notif", true);
    await getConfig("support_username", "Not Set");
    await getConfig("payout_channel", "Not Set");
    await getConfig("banned_in_channel_allowed", true);
    await getConfig("non_admin_channels_bypass", true);
    await getConfig("show_mode", "all");
    await getConfig("force_join_enabled", true);
    await getConfig("default_task_alert_channel", "Not Set");
    await getConfig("owner_id", MAIN_OWNER_ID);
    await getConfig("unknown_command_active", false);
    await getConfig("unknown_command_text", "❓ I didn't understand that.\n\nPlease /start the bot again.");
    await getConfig("bot_font", "normal");
    await getConfig("deposit_enabled", false);
    await getConfig("deposit_message", "Deposit is currently unavailable. Please contact support.");
    await getConfig("gift_code_text", "🎁 Enter Your Gift Code:");
    await getConfig("gift_code_link", "Not Set");
    await getConfig("button_colors", {});

    let savedLayoutVersion = await getConfig("layout_version", "v1");
    if (savedLayoutVersion !== CURRENT_LAYOUT_VERSION) {
      await setConfig("admin_panel_layout", DEFAULT_ADMIN_PANEL_LAYOUT);
      await setConfig("keyboard_layout", DEFAULT_KEYBOARD_LAYOUT);
      await setConfig("layout_version", CURRENT_LAYOUT_VERSION);
    }

    let fund = await LiveFund.findOne({ key: "main_fund" });
    if (!fund) await LiveFund.create({ key: "main_fund" });

    let wsCount = await WithdrawSettings.countDocuments({});
    if (wsCount === 0) {
      await WithdrawSettings.create({ method: "upi", isActive: true, minAmount: 0, maxAmount: 0, taxPercent: 0 });
    }

    setInterval(async () => {
      try {
        let now = new Date();
        let expiredTasks = await Task.find({ expiresAt: { $ne: null, $lte: now }, isComplete: true });
        for (let task of expiredTasks) { await Task.deleteOne({ taskId: task.taskId }); }
      } catch (e) { }
    }, 60 * 1000);

    await new Promise(r => setTimeout(r, 8000));
    await startBotSafe();
  })
  .catch((err) => { console.error("❌ DB Error:", err); process.exit(1); });

const server = app.listen(PORT, "0.0.0.0", () => { console.log(`🌐 Server running on port ${PORT}`); });
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} in use. Retrying...`);
    setTimeout(() => { server.close(); server.listen(PORT, "0.0.0.0"); }, 2000);
  }
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });

setInterval(() => {
  let renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderUrl) fetch(renderUrl).catch(() => { });
}, 300000);

setInterval(() => {
  if (global.quickPayCache) { for (let uid in global.quickPayCache) delete global.quickPayCache[uid]; }
  if (global.broadcastCache) { for (let uid in global.broadcastCache) delete global.broadcastCache[uid]; }
  if (global.taskCreation) { for (let uid in global.taskCreation) delete global.taskCreation[uid]; }
}, 30 * 60 * 1000);
