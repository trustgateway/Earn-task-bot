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
    for (let btn of row) kb.text(btn.text, btn.url);
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

const withdrawSettingsSchema = new mongoose.Schema({
  method: { type: String, required: true, unique: true },
  isActive: { type: Boolean, default: true },
  minAmount: { type: Number, default: 0 },
  maxAmount: { type: Number, default: 0 },
  taxPercent: { type: Number, default: 0 },
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

const DEFAULT_KEYBOARD_LAYOUT = [
  { name: `📋 ${toSmallCaps("Bot Task")}`, key: "btn_tasks", row: 0, hidden: false },
  { name: `💸 ${toSmallCaps("My Balance")}`, key: "btn_balance", row: 0, hidden: false },
  { name: `🎁 ${toSmallCaps("Gift Code")}`, key: "btn_gift", row: 1, hidden: false },
  { name: `⚡ ${toSmallCaps("Quick Pay")}`, key: "btn_quickpay", row: 1, hidden: false },
  { name: `💳 ${toSmallCaps("Payout Method")}`, key: "btn_payout", row: 2, hidden: false },
  { name: `🚀 ${toSmallCaps("Withdraw")}`, key: "btn_withdraw", row: 2, hidden: false }
];

const DEFAULT_ADMIN_PANEL_LAYOUT = [
  { name: `👮 Add/Remove Admins Permission`, key: "adm_permissions", row: 0, hidden: false },
  { name: `👑 Transfer Ownership`, key: "adm_transfer", row: 1, hidden: false },
  { name: `💰 Set Withdraw Tax`, key: "adm_set_wd_tax", row: 1, hidden: false },
  { name: `👮 Manage Admins`, key: "adm_admins", row: 2, hidden: false },
  { name: `🚫 Manage Ban Users`, key: "adm_manage_ban", row: 2, hidden: false },
  { name: `🤖 Bot Status`, key: "adm_bot_status", row: 3, hidden: false },
  { name: `🚫 Manage Ban Wallet`, key: "adm_manage_ban_wallet", row: 3, hidden: false },
  { name: `💸 Withdraw Status`, key: "adm_wd_status", row: 4, hidden: false },
  { name: `➕ Add Balance`, key: "adm_add_bal", row: 4, hidden: false },
  { name: `➖ Remove Balance`, key: "adm_rem_bal", row: 5, hidden: false },
  { name: `⚡ Manage Your Channels`, key: "adm_manage_channels", row: 5, hidden: false },
  { name: `⚠️ Reset Balance`, key: "adm_reset_all_bal", row: 6, hidden: false },
  { name: `🎨 Customize Your Theme`, key: "adm_customize_theme", row: 6, hidden: false },
  { name: `💬 Talk With User`, key: "adm_talk_user", row: 7, hidden: false },
  { name: `📢 Broadcast`, key: "adm_broadcast", row: 7, hidden: false },
  { name: `🔍 Find User Details`, key: "adm_find_user", row: 8, hidden: false },
  { name: `📊 Status`, key: "adm_status", row: 8, hidden: false },
  { name: `⚡ Quick Pay`, key: "adm_quick_pay", row: 9, hidden: false },
  { name: `🚀 Withdrawal Step`, key: "adm_gateway_menu", row: 9, hidden: false },
  { name: `🎁 Gift Codes`, key: "adm_create_gift", row: 10, hidden: false },
  { name: `🔔 New User Notification`, key: "adm_user_notif", row: 11, hidden: false },
  { name: `🎁 Manage Redeem Codes`, key: "adm_redeem", row: 11, hidden: false },
  { name: `📧 Manage Amazon Codes`, key: "adm_amazon", row: 12, hidden: false },
  { name: `📋 Manage Tasks`, key: "adm_tasks_manager", row: 12, hidden: false },
  { name: `🚀 Recent Admin Actions`, key: "adm_recent_actions", row: 13, hidden: false },
  { name: `🔄 Refresh Panel`, key: "admin", row: 13, hidden: false }
];

const DEFAULT_BALANCE_TEXT = {
  welcome: `⭐ ${toSmallCaps("Welcome To Bot!")}`,
  footer: `❝ ${toSmallCaps("Built with security you can Trust.")}\n${toSmallCaps("Support that responds promptly")} ❞`
};

const DEFAULT_START_TEXT = {
  title: `💫 ${toSmallCaps("Welcome To Task Payment Bot!")}`,
  linkPrefix: `${toSmallCaps("How To Earn")} → `,
  linkClickable: `${toSmallCaps("Click Here")}`
};

const FONT_OPTIONS = [
  { key: "normal", name: "Normal", preview: "Admin Panel" },
  { key: "smallcaps", name: "Small Caps", preview: "ᴀᴅᴍɪɴ ᴘᴀɴᴇʟ" },
  { key: "capital_smallcaps", name: "Capital Small Caps", preview: "Aᴅᴍɪɴ Pᴀɴᴇʟ" },
  { key: "bold", name: "Bold", preview: "Admin Panel" },
  { key: "italic", name: "Italic", preview: "Admin Panel" },
  { key: "bold_italic", name: "Bold Italic", preview: "Admin Panel" },
  { key: "monospace", name: "Monospace", preview: "Admin Panel" },
  { key: "underline", name: "Underline", preview: "Admin Panel" },
  { key: "strike", name: "Strike", preview: "Admin Panel" },
  { key: "spoiler", name: "Spoiler", preview: "Admin Panel" }
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

  for (let m of ["upi", "bank", "wallet", "amazon", "redeem"]) {
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
    keyboardRows = [[{ text: `💸 ${toSmallCaps("My Balance")}` }]];
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
        `⏳ ${toSmallCaps("Processing")} ${buildProcessingDots(frame)}`,
        { parse_mode: "HTML" }
      );
    } catch (e) { }
    frame++;
  }, 400);
  return interval;
}

async function processGatewayPayout({
  bot, userId, amount, gatewayInfo, wallet, channelList = [], showRemainingBalance = true
}) {
  try {
    let urlTemplate = gatewayInfo.url_template || gatewayInfo.url || "";
    let finalUrl = urlTemplate
      .replace(/{wallet}/g, encodeURIComponent(wallet))
      .replace(/{amount}/g, encodeURIComponent(amount))
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

    let msg = `✅ <b>New Withdrawal Processed</b> ✅\n\n` +
              `🟢 <b>User :</b> <b>${userId}</b>\n`;
    if (showRemainingBalance) msg += `🤘 <b>Remaining Balance :-</b> ₹<code>${newBalance.toFixed(2)}</code>\n`;
    msg += `\n🚀 <b>Amount :</b> ₹<b><code>${amount}</code></b> INR (-)\n` +
           `⛔ <b>Address :</b> <b><code>${maskedWallet}</code></b>\n\n` +
           `💡 <b>Bot:</b> @${botUsername}\n\n` +
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
              `🟢 <b>User :</b> <b>${userId}</b>\n` +
              `🤘 <b>Remaining Balance :-</b> ₹<code>${newBalance.toFixed(2)}</code>\n\n` +
              `🚀 <b>Amount :</b> ₹<b><code>${amount}</code></b> INR (-)\n` +
              `🏦 <b>UPI :</b> <b><code>${maskedUPI}</code></b>\n` +
              `🌐 <b>Gateway :</b> ${gateway.name}\n\n` +
              `💡 <b>Bot:</b> @${botUsername}\n\n` +
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
    let result = await processGatewayPayout({ bot, userId: uid, amount: amt, gatewayInfo: gateway, wallet, channelList, showRemainingBalance: true });

    if (result.status === 'success') {
      let txnNumber = result.txnNumber || generateTxnNumber();
      let processTime = new Date();
      await Withdrawal.create({
        withdrawalId, userId: uid, userWithdrawalCount, amount: amt,
        method: gatewayName, details: wallet, status: "Approved",
        isGateway: true, gatewayName: gateway.name,
        gatewayResponse: result.rawResponse || "",
        txnNumber, taxPercent, taxAmount, netAmount: amt - taxAmount,
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
    else if (method === "Amazon") details = user.amazonEmail;
    else if (method === "Redeem") details = user.redeemCodeAddr;
    else return res.json({ success: false, error: "Invalid method" });
    if (!details || details === "Not Set" || details.trim() === "" || details.includes("Not Set")) return res.json({ success: false, error: `${method} not linked!`, needsLink: true, method });
    let minW = methodSetting ? methodSetting.minAmount : 0;
    let maxW = methodSetting ? methodSetting.maxAmount : 0;
    if (minW > 0 && amt < minW) return res.json({ success: false, error: `Min ₹${minW}` });
    if (maxW > 0 && amt > maxW) return res.json({ success: false, error: `Max ₹${maxW}` });
    if (user.balance < amt) return res.json({ success: false, error: "Insufficient balance" });

    let taxPercent = methodSetting ? (methodSetting.taxPercent || 0) : 0;
    let taxAmount = taxPercent > 0 ? (amt * taxPercent) / 100 : 0;

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
    await Withdrawal.create({ withdrawalId, userId: uid, userWithdrawalCount, amount: amt, method, details, isGateway: false, taxPercent, taxAmount, netAmount: amt - taxAmount });
    let payoutChannel = await getPayoutChannel(method);
    if (payoutChannel && payoutChannel !== "Not Set") {
      const adminKb = new InlineKeyboard().text("Approve ✅", `wd_app_${withdrawalId}`).text("Reject ❌", `wd_rej_${withdrawalId}`);
      const userLink = `<a href="tg://user?id=${uid}"><b>${uid}</b></a>`;
      const hashTag = `<code>(#${userWithdrawalCount})</code>`;
      const methodIcon = method === 'UPI' ? '⚡' : method === 'Bank' ? '🏦' : method === 'Amazon' ? '📧' : '🎁';
      try {
        await bot.api.sendMessage(payoutChannel,
          `⚠️ <b>New ${method.toUpperCase()} Payout Request!</b> ${hashTag}\n\n` +
          `User : ${userLink}\n` +
          `Request Amount : ₹<code>${amt}</code>\n` +
          `Amount After Tax : ₹<code>${(amt - taxAmount).toFixed(2)}</code>\n` +
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
      await bot.api.sendMessage(rId, `💸 ${toSmallCaps("You Received")} ₹${receiverAmount.toFixed(2)} ${toSmallCaps("From")} <a href="tg://user?id=${sId}">${escapeHtml(sender.firstName || "User")}</a>`, { parse_mode: "HTML" }).catch(() => { });
    } catch (e) { }
    res.json({ success: true, newBalance: sender.balance });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/update-payment", async (req, res) => {
  try {
    const { userId, field, value } = req.body;
    const uid = parseInt(userId, 10);
    const allowed = ["walletNumber", "upiId", "bankAccNo", "bankIfsc", "amazonEmail", "redeemCodeAddr", "walletAccount"];
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
    const kb = new InlineKeyboard().text("Approve ✅", `task_app_${submissionId}`).text("Reject ❌", `task_rej_${submissionId}`);
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
    let kb = new InlineKeyboard().text("Approve ✅", `task_app_${submissionId}`).text("Reject ❌", `task_rej_${submissionId}`);
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
    try { await bot.api.sendMessage(payment.userId, `✅ ${toSmallCaps("Deposit Approved!")}\n\n💰 ₹${payment.amount}\n🔐 ${payment.utr}`, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/reject-upi/:id", async (req, res) => {
  try {
    const payment = await UPIPayment.findOne({ orderId: req.params.id });
    if (!payment || payment.status === "Rejected") return res.json({ success: false, error: "Already processed" });
    payment.status = "Rejected"; payment.approvedBy = "MiniApp Admin";
    await payment.save();
    try { await bot.api.sendMessage(payment.userId, `❌ ${toSmallCaps("Deposit Rejected")}\n\n💰 ₹${payment.amount}\n🔐 ${payment.utr}`, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
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
    try { await bot.api.sendMessage(uid, `💰 ${toSmallCaps("Admin Gave You A Decrease In Balance By")} ${amt}`, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
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
    try { await bot.api.sendMessage(uid, `💰 ${toSmallCaps("Admin Gave You A Increase In Balance By")} ${amt}`, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
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
      tax_percent: await getConfig("tax_percent", 0),
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
      auto_upi_id: await getConfig("auto_upi_id", "payzy@upi"),
      auto_upi_min: await getConfig("auto_upi_min", 5),
      auto_upi_max: await getConfig("auto_upi_max", 200),
      quick_pay_enabled: await getConfig("quick_pay_enabled", true),
      quick_pay_unlimited: await getConfig("quick_pay_unlimited", true),
      quick_pay_negative_balance: await getConfig("quick_pay_negative_balance", false),
      quick_pay_tax_percent: await getConfig("quick_pay_tax_percent", 0),
      quick_pay_whitelist: await getConfig("quick_pay_whitelist", []),
      unknown_command_active: await getConfig("unknown_command_active", false),
      unknown_command_text: await getConfig("unknown_command_text", "❓ I didn't understand that.\n\nPlease /start the bot again."),
      deposit_enabled: await getConfig("deposit_enabled", false),
      deposit_message: await getConfig("deposit_message", "Deposit is currently unavailable. Please contact support.")
    };
    res.json({ success: true, settings });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/settings/update", async (req, res) => {
  try {
    const { key, value } = req.body;
    const allowed = ["min_withdraw", "max_withdraw", "tax_percent", "payout_channel", "support_username", "bot_active", "withdraw_enabled", "balance_footer_text", "balance_welcome_text", "start_title_text", "start_link_prefix", "start_link_clickable", "welcome_channel_link", "auto_upi_id", "auto_upi_min", "auto_upi_max", "quick_pay_enabled", "quick_pay_unlimited", "quick_pay_negative_balance", "quick_pay_tax_percent", "quick_pay_whitelist", "unknown_command_active", "unknown_command_text", "deposit_enabled", "deposit_message"];
    if (!allowed.includes(key)) return res.json({ success: false, error: "Invalid key" });
    await setConfig(key, value);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/broadcast", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || message.trim() === "") return res.json({ success: false, error: "Empty message" });
    const users = await User.find({}).lean();
    let sent = 0, failed = 0;
    for (let u of users) {
      try { await bot.api.sendMessage(u.userId, message).catch(() => { }); sent++; await new Promise(r => setTimeout(r, 50)); }
      catch (e) { failed++; }
    }
    res.json({ success: true, sent, failed, total: users.length });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/admin/list", async (req, res) => {
  try {
    const ownerId = await getConfig("owner_id", MAIN_OWNER_ID);
    const ownerUser = await User.findOne({ userId: ownerId }).lean();
    const admins = await BotAdmin.find({}).sort({ addedAt: -1 }).lean();
    let list = [{ userId: ownerId, name: ownerUser?.firstName || "Owner", role: "owner" }];
    for (let a of admins) {
      let u = await User.findOne({ userId: a.userId }).lean();
      list.push({ userId: a.userId, name: u?.firstName || "Admin", role: a.isActive ? "admin" : "disabled" });
    }
    res.json({ success: true, admins: list });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/add", async (req, res) => {
  try {
    const { userId: newAdminId, requesterId } = req.body;
    const reqId = parseInt(requesterId, 10);
    const nId = parseInt(newAdminId, 10);
    if (!(await isOwner(reqId))) return res.json({ success: false, error: "Owner only" });
    const targetUser = await User.findOne({ userId: nId });
    if (!targetUser) return res.json({ success: false, error: "User not found" });
    await BotAdmin.findOneAndUpdate({ userId: nId }, { addedAt: new Date(), addedBy: reqId, isActive: true }, { upsert: true });
    await logAdminAction(reqId, "Owner", "Admin Added", `Added ${nId}`, 0, nId);
    try {
      await bot.api.sendMessage(nId, `🎉 <b>Congratulations!</b>\nYou are now Admin!\n\nUse /admin to open Admin Panel.`, { parse_mode: "HTML" }).catch(() => { });
    } catch (e) { }
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/remove/:id", async (req, res) => {
  try {
    const adminId = parseInt(req.params.id, 10);
    const { requesterId } = req.body;
    const reqId = parseInt(requesterId, 10);
    if (!(await isOwner(reqId))) return res.json({ success: false, error: "Owner only" });
    await BotAdmin.deleteOne({ userId: adminId });
    await logAdminAction(reqId, "Owner", "Admin Removed", `Removed ${adminId}`, 0, adminId);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/toggle-admin/:id", async (req, res) => {
  try {
    const adminId = parseInt(req.params.id, 10);
    const { requesterId } = req.body;
    const reqId = parseInt(requesterId, 10);
    if (!(await isOwner(reqId))) return res.json({ success: false, error: "Owner only" });
    const admin = await BotAdmin.findOne({ userId: adminId });
    if (!admin) return res.json({ success: false, error: "Admin not found" });
    admin.isActive = !admin.isActive;
    if (!admin.isActive) { admin.disabledAt = new Date(); admin.disabledBy = reqId; }
    else { admin.disabledAt = null; admin.disabledBy = null; }
    await admin.save();
    await logAdminAction(reqId, "Owner", admin.isActive ? "Admin Enabled" : "Admin Disabled", `${adminId}`, 0, adminId);
    res.json({ success: true, isActive: admin.isActive });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/transfer-owner", async (req, res) => {
  try {
    const { newOwnerId, requesterId } = req.body;
    const reqId = parseInt(requesterId, 10);
    const nId = parseInt(newOwnerId, 10);
    if (!(await isOwner(reqId))) return res.json({ success: false, error: "Owner only" });
    const targetUser = await User.findOne({ userId: nId });
    if (!targetUser) return res.json({ success: false, error: "User not found" });
    await BotAdmin.findOneAndUpdate({ userId: reqId }, { addedAt: new Date(), addedBy: reqId, isActive: true }, { upsert: true });
    await setConfig("owner_id", nId);
    await logAdminAction(reqId, "Owner", "Ownership Transferred", `New owner: ${nId}`, 0, nId);
    try { await bot.api.sendMessage(nId, `👑 Congratulations! You are now the OWNER of this bot!`).catch(() => { }); } catch (e) { }
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
        { method: "upi", minAmount: 0, maxAmount: 0, isActive: true },
        { method: "bank", minAmount: 0, maxAmount: 0, isActive: true },
        { method: "amazon", minAmount: 0, maxAmount: 0, isActive: false },
        { method: "redeem", minAmount: 0, maxAmount: 0, isActive: false }
      ];
      for (let m of methods) await WithdrawSettings.create(m);
      settings = await WithdrawSettings.find({}).lean();
    }
    res.json({ success: true, settings });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/miniapp/api/admin/withdraw-settings/update", async (req, res) => {
  try {
    const { method, isActive, minAmount, maxAmount, taxPercent } = req.body;
    if (!method) return res.json({ success: false, error: "Method required" });
    let update = {};
    if (isActive !== undefined) update.isActive = isActive;
    if (minAmount !== undefined) update.minAmount = parseFloat(minAmount);
    if (maxAmount !== undefined) update.maxAmount = parseFloat(maxAmount);
    if (taxPercent !== undefined) update.taxPercent = parseFloat(taxPercent);
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

    if (user.isBanned) return ctx.reply(`${toSmallCaps("You are banned from using this bot.")}`, { parse_mode: "HTML" }).catch(() => { });

    let botStatus = await getConfig("bot_status", "active");
    if (botStatus === "maintenance" || botStatus === "disabled") {
      let isAdminUser = await isAdmin(userId);
      if (!isAdminUser) {
        let botOffText;
        if (botStatus === "maintenance") botOffText = await getConfig("bot_maintenance_text", `⚠️ ${toSmallCaps("Bot is under maintenance. Please try again later.")}`);
        else botOffText = await getConfig("bot_off_text", `❌ ${toSmallCaps("Bot is currently disabled.")}`);
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
  let title = `⚠️ ${toSmallCaps("You Must Join Our Channels!")}`;
  let bodyText = `👇 ${toSmallCaps("Join all channels below")}:`;
  let text = `${title}\n\n<blockquote>${bodyText}</blockquote>`;
  if (notJoinedCount > 0) text += `\n\n${toSmallCaps(`You have not joined in ${notJoinedCount} channels`)}`;

  let kb = new InlineKeyboard();
  for (let ch of displayChannels) kb.url(`📢 ${ch.displayName || ch.channelId}`, ch.inviteLink).row();
  kb.text(makeBtn("Claim"), "check_join");
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
  await ctx.reply(`✅ ${toSmallCaps("Verified!")}\n\n${toSmallCaps("Welcome to the bot!")}`, { parse_mode: "HTML", reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
});

async function saveCodes(text, type, ctx) {
  let lines = text.trim().split("\n").filter(l => l.trim() !== "");
  let added = [], failed = [];
  for (let line of lines) {
    let parts = line.trim().split(/\s+/);
    if (parts.length !== 2) { failed.push(`${line} (invalid)`); continue; }
    let code = parts[0].trim();
    let amount = parseFloat(parts[1]);
    if (isNaN(amount) || amount <= 0) { failed.push(`${line} (invalid)`); continue; }
    let existing = await GiftCode.findOne({ code, type });
    if (existing) { failed.push(`${code} (exists)`); continue; }
    await GiftCode.create({ code, amount, type, maxUses: 1, usedUsers: [] });
    added.push(`✅ \`${code}\` → ₹${amount}`);
  }
  let icon = type === "amazon" ? "📧" : "🎁";
  let title = type === "amazon" ? "Amazon Codes" : "Redeem Codes";
  let summary = `${icon} *${title} Added*\n\n`;
  if (added.length > 0) summary += `✅ Added (${added.length}):\n${added.join("\n")}\n\n`;
  if (failed.length > 0) summary += `❌ Failed (${failed.length}):\n${failed.map(f => `• ${f}`).join("\n")}\n\n`;
  summary += `📊 Added: ${added.length} | ❌ Failed: ${failed.length}`;
  await ctx.reply(summary, { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("Back", type === "amazon" ? "adm_amazon" : "adm_create_gift") }).catch(() => { });
}

async function buildWithdrawMenu() {
  let buttons = [];
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;

  let gateways = await Gateway.find({ isActive: true }).sort({ createdAt: 1 }).lean();
  for (let gw of gateways) buttons.push([{ text: makeBtn(gw.name.toUpperCase()), callback_data: `wd_gw_${gw.name}` }]);

  let autoUpis = await AutoUpi.find({ status: "active" }).sort({ order: 1, createdAt: 1 }).lean();
  for (let au of autoUpis) buttons.push([{ text: makeBtn(`⚡ ${au.name} (Auto UPI)`), callback_data: `wd_auto_${au.gatewayId}` }]);

  let methods = ["upi", "bank", "amazon", "redeem"];
  for (let m of methods) {
    let s = await WithdrawSettings.findOne({ method: m }).lean();
    if (s && s.isActive) buttons.push([{ text: makeBtn(m.toUpperCase()), callback_data: `wd_${m}` }]);
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
    let msg = `${welcomeText}\n\n🔵 ${toSmallCaps("Wallet ID")} ➝ <code>${userId}</code>\n🧾 ${toSmallCaps("Balance")} ➝ <code>${balanceDisplay}</code>\n\n<blockquote>${footerText}</blockquote>`;

    let buttons = [];
    let depositEnabled = await getConfig("deposit_enabled", false);
    if (depositEnabled) buttons.push([{ text: `💰 ${toSmallCaps("Deposit")}`, callback_data: "user_deposit" }]);
    buttons.push([
      { text: `📊 ${toSmallCaps("Balance Statement")}`, callback_data: "balance_statement" },
      { text: `💰 ${toSmallCaps("Live Fund")}`, callback_data: "live_fund" }
    ]);
    buttons.push([{ text: `🔄 ${toSmallCaps("Refresh")}`, callback_data: "refresh_balance_only" }]);
    let kb = await buildStyledKb(buttons);

    let shouldAnimate = animate && newBalance > 0 && startBalance !== newBalance;

    if (shouldAnimate) {
      let messageId = null;
      let chatId = ctx.chat.id;

      if (edit && ctx.callbackQuery) {
        messageId = ctx.callbackQuery.message.message_id;
      } else {
        let initialMsg = msg.replace(/₹[\d,]+\.\d{2}/, `₹0.00`);
        let sent = await ctx.reply(initialMsg, { reply_markup: kb, parse_mode: "HTML" }).catch(() => null);
        if (!sent) return;
        messageId = sent.message_id;
      }

      if (messageId) {
        let steps = 8;
        let diff = newBalance - startBalance;

        for (let i = 1; i <= steps; i++) {
          let progress = i / steps;
          let eased = 1 - Math.pow(1 - progress, 3);
          let currentBalance = startBalance + (diff * eased);
          let animMsg = msg.replace(/₹[\d,]+\.\d{2}/, `₹${currentBalance.toFixed(2)}`);
          try {
            await ctx.api.editMessageText(chatId, messageId, animMsg, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
          } catch (e) { }
          await new Promise(r => setTimeout(r, 100));
        }

        await ctx.api.editMessageText(chatId, messageId, msg, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
        return;
      }
    }

    try {
      if (edit && ctx.callbackQuery) {
        await ctx.editMessageText(msg, { reply_markup: kb, parse_mode: "HTML" });
      } else {
        await ctx.reply(msg, { reply_markup: kb, parse_mode: "HTML" });
      }
    } catch (htmlErr) {
      let plainWelcome = String(welcomeText).replace(/<[^>]*>/g, "");
      let plainFooter = String(footerText).replace(/<[^>]*>/g, "");
      let plainMsg = `${plainWelcome}\n\n🔵 Wallet ID ➝ ${userId}\n🧾 Balance ➝ ${balanceDisplay}\n\n${plainFooter}`;
      if (edit && ctx.callbackQuery) {
        await ctx.editMessageText(plainMsg, { reply_markup: kb }).catch(() => { });
      } else {
        await ctx.reply(plainMsg, { reply_markup: kb }).catch(() => { });
      }
    }
  } catch (e) {
    console.error("sendBalancePage error:", e.message);
    try {
      await ctx.reply(`💰 Balance: ₹${(await getUser(ctx.from.id)).balance.toFixed(2)}`).catch(() => { });
    } catch (_) { }
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
    let bankWs = await WithdrawSettings.findOne({ method: "bank" }).lean();
    let showUPI = upiWs ? upiWs.isActive : false;
    let showBank = bankWs ? bankWs.isActive : false;

    let msg = `<b>${toSmallCaps("Payout Method")}</b>\n\n`;
    if (showUPI) msg += `${toSmallCaps("UPI")} : ${fmt(user.upiId)}\n\n`;
    msg += `${toSmallCaps("Set Wallet")} : ${fmt(user.walletNumber)}\n\n`;
    if (showBank) msg += `${toSmallCaps("Bank")} : ${(user.bankAccNo !== "Not Set") ? `${user.bankAccNo} (${user.bankIfsc})` : "Not Set"}\n`;

    let kb = new InlineKeyboard();
    if (showUPI) kb.text(makeBtn("Set UPI"), "set_upi").row();
    kb.text(makeBtn("Set Wallet"), "set_wallet_number").row();
    if (showBank) kb.text(makeBtn("Set Bank"), "set_bank").row();
    kb.text(makeBtn("Back"), "back_to_balance");

    if (edit && ctx.callbackQuery) await ctx.editMessageText(msg, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
    else await ctx.reply(msg, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
  } catch (e) { console.error("sendPayoutMethodPage:", e.message); }
}

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
      } catch (err) {
        console.error("Admin handler error:", err.message);
      }
    }

    if (state) {
      if (text === `${toSmallCaps("Cancel")}` || text === "❌ Cancel" || text.toLowerCase() === "cancel") {
        delete userState[userId];
        if (global.quickPayCache) delete global.quickPayCache[userId];
        await ctx.reply(`${toSmallCaps("Cancelled")}`, { reply_markup: await buildKeyboardFromLayout(userId), parse_mode: "HTML" }).catch(() => { });
        return;
      }

      if (state === "AWAITING_WITHDRAW_METHOD") {
        return ctx.reply(`⚠️ ${toSmallCaps("Please select a withdraw method first")}`, { parse_mode: "HTML", reply_markup: await buildStyledKb(await buildWithdrawMenu()) }).catch(() => { });
      }

      if (state === "SET_WALLET_NUMBER") {
        delete userState[userId];
        let number = text.trim();
        if (!validateWallet(number)) return ctx.reply(`⛔️ <b>Invalid Wallet Number</b>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "btn_payout_back") }).catch(() => { });
        let user = await getUser(userId);
        user.walletNumber = number;
        await user.save();
        await ctx.reply(`✅ <b>${toSmallCaps("Wallet Added Successfully")}</b>\n\nWallet : <code>${number}</code>`, { parse_mode: "HTML", reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        return;
      }

      if (state === "SET_UPI_ACC") {
        let upi = text.trim();
        if (!validateUPI(upi)) return ctx.reply(`⛔️ <b>Invalid UPI/VPA Address</b>`, { parse_mode: "HTML" }).catch(() => { });
        delete userState[userId];
        await User.findOneAndUpdate({ userId }, { upiId: upi });
        await ctx.reply(`✅ <b>${toSmallCaps("UPI Added Successfully")}</b>\n\nUPI ID : <code>${upi}</code>`, { parse_mode: "HTML", reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        return;
      }

      if (state === "SET_BANK_ACCNO") {
        let accNo = text.trim();
        if (!validateBankAcc(accNo)) return ctx.reply(`⛔️ <b>Invalid Account Number</b>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "btn_payout_back") }).catch(() => { });
        userState[userId] = `SET_BANK_IFSC_${accNo}`;
        return ctx.reply(`📝 <b>${toSmallCaps("Send Your IFSC Code")}</b>\n\n${toSmallCaps("Format")}: <code>SBIN0001234</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "btn_payout_back") }).catch(() => { });
      }

      if (state.startsWith("SET_BANK_IFSC_")) {
        let accNo = state.replace("SET_BANK_IFSC_", "");
        let ifsc = text.trim().toUpperCase();
        if (!validateIFSC(ifsc)) return ctx.reply(`⛔️ <b>Invalid IFSC Code</b>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "btn_payout_back") }).catch(() => { });
        delete userState[userId];
        await User.findOneAndUpdate({ userId }, { bankAccNo: accNo, bankIfsc: ifsc });
        await ctx.reply(`✅ <b>${toSmallCaps("Bank Added Successfully")}</b>\n\nBank : <code>${accNo} (${ifsc})</code>`, { parse_mode: "HTML", reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        return;
      }

      if (state.startsWith("GW_NUMBER_")) {
        let gwName = state.replace("GW_NUMBER_", "");
        let number = text.trim();
        if (!validateWallet(number)) return ctx.reply(`⛔️ <b>Invalid Wallet Number</b>`, { parse_mode: "HTML" }).catch(() => { });
        let gateway = await Gateway.findOne({ name: gwName, isActive: true });
        if (!gateway) { delete userState[userId]; return ctx.reply(`❌ ${toSmallCaps("Gateway not found.")}`).catch(() => { }); }
        let user = await getUser(userId);
        user.walletNumber = number;
        await user.save();
        userState[userId] = `GW_AMOUNT_${gwName}`;
        let kb = new Keyboard().text("Cancel").resized().oneTime();
        return ctx.reply(`${toSmallCaps("Enter Withdraw Amount")}`, { parse_mode: "HTML", reply_markup: kb }).catch(() => { });
      }

      if (state.startsWith("GW_AMOUNT_")) {
        let gwName = state.replace("GW_AMOUNT_", "");
        delete userState[userId];
        let amount = parseFloat(text);
        if (isNaN(amount) || amount <= 0) return ctx.reply(`❌ ${toSmallCaps("Invalid amount!")}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        let user = await getUser(userId);
        let gateway = await Gateway.findOne({ name: gwName, isActive: true });
        if (!gateway) return ctx.reply(`❌ ${toSmallCaps("Gateway not found.")}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        let minW = gateway.minAmount || 0;
        let maxW = gateway.maxAmount || 0;
        if (minW > 0 && amount < minW) return ctx.reply(`❌ ${toSmallCaps("Minimum")}: ₹${minW}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (maxW > 0 && amount > maxW) return ctx.reply(`❌ ${toSmallCaps("Maximum")}: ₹${maxW}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (user.balance < amount) return ctx.reply(`❌ ${toSmallCaps("Insufficient balance!")} ${toSmallCaps("Your Balance")}: ₹${user.balance.toFixed(2)}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        let wallet = user.walletNumber || "";
        if (!wallet) return ctx.reply(`❌ ${toSmallCaps("Number not saved!")}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        let taxPercent = gateway.taxPercent || 0;
        let taxAmount = 0;
        let receiveAmount = amount;
        if (taxPercent > 0) { taxAmount = (amount * taxPercent) / 100; receiveAmount = amount - taxAmount; }
        let bodyText = `${toSmallCaps("Amount")}: <code>${amount}</code> INR\n` +
          `${toSmallCaps("You receive")}: <code>${receiveAmount.toFixed(2)}</code> INR (Tax: <code>₹${taxAmount.toFixed(2)}</code>)\n\n` +
          `🔗 ${gwName} ${toSmallCaps("Wallet")}: <code>${wallet}</code>`;
        let confirmMsg = `<b>${toSmallCaps("Withdrawal Confirmation")}</b>\n\n<blockquote>${bodyText}</blockquote>\n\n${toSmallCaps("Confirm your transaction by clicking Confirm")}`;
        userState[userId] = `GW_CONFIRM_${gwName}_${amount}`;
        return ctx.reply(confirmMsg, {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text(makeBtn("Confirm ✅"), `gw_conf_yes_${gwName}_${amount}`).row()
            .text(makeBtn("Cancel ❌"), `gw_conf_no`)
        }).catch(() => { });
      }

      if (state.startsWith("MANUAL_AMOUNT_auto_upi_")) {
        let gwId = state.replace("MANUAL_AMOUNT_auto_upi_", "");
        delete userState[userId];
        let amount = parseFloat(text);
        if (isNaN(amount) || amount <= 0) return ctx.reply(`❌ ${toSmallCaps("Invalid amount!")}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        let gw = await AutoUpi.findOne({ gatewayId: gwId, status: "active" });
        if (!gw) return ctx.reply(`❌ Gateway not available`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        let user = await getUser(userId);
        if (!user.upiId || user.upiId === "Not Set") return ctx.reply(`❌ UPI not linked!`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (gw.minAmount > 0 && amount < gw.minAmount) return ctx.reply(`❌ Min: ₹${gw.minAmount}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (gw.maxAmount > 0 && amount > gw.maxAmount) return ctx.reply(`❌ Max: ₹${gw.maxAmount}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (user.balance < amount) return ctx.reply(`❌ Insufficient balance!`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        let taxPercent = gw.taxPercent || 0;
        let taxAmount = taxPercent > 0 ? (amount * taxPercent) / 100 : 0;
        let netAmount = amount - taxAmount;
        let bodyText = `${toSmallCaps("Amount")}: <code>${amount}</code> INR\n` +
          `${toSmallCaps("You receive")}: <code>${netAmount.toFixed(2)}</code> INR (Tax: <code>₹${taxAmount.toFixed(2)}</code>)\n\n` +
          `⚡ ${gw.name} (Auto UPI)\n` +
          `UPI : <code>${user.upiId}</code>`;
        let confirmMsg = `<b>${toSmallCaps("Withdrawal Confirmation")}</b>\n\n<blockquote>${bodyText}</blockquote>\n\n${toSmallCaps("Confirm your transaction by clicking Confirm")}`;
        return ctx.reply(confirmMsg, {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text(makeBtn("Confirm ✅"), `auto_upi_confirm_${gwId}_${amount}`).row()
            .text(makeBtn("Cancel ❌"), "auto_upi_cancel")
        }).catch(() => { });
      }

      if (state.startsWith("MANUAL_AMOUNT_")) {
        let method = state.replace("MANUAL_AMOUNT_", "");
        delete userState[userId];
        let amount = parseFloat(text);
        if (isNaN(amount) || amount <= 0) return ctx.reply(`❌ ${toSmallCaps("Invalid amount!")}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        let user = await getUser(userId);
        let details = "";
        if (method === "upi") details = user.upiId;
        else if (method === "bank") details = (user.bankAccNo && user.bankAccNo !== "Not Set") ? `${user.bankAccNo}, ${user.bankIfsc}` : "";
        else if (method === "amazon") details = user.amazonEmail;
        else if (method === "redeem") details = user.redeemCodeAddr;
        if (!details || details === "Not Set" || details.includes("Not Set")) return ctx.reply(`❌ ${method.toUpperCase()} ${toSmallCaps("not linked! Please add it first.")}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        let ws = await WithdrawSettings.findOne({ method }).lean();
        let minW = ws ? ws.minAmount : 0;
        let maxW = ws ? ws.maxAmount : 0;
        if (minW > 0 && amount < minW) return ctx.reply(`❌ ${toSmallCaps("Minimum")}: ₹${minW}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (maxW > 0 && amount > maxW) return ctx.reply(`❌ ${toSmallCaps("Maximum")}: ₹${maxW}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (user.balance < amount) return ctx.reply(`❌ ${toSmallCaps("Insufficient balance!")} ${toSmallCaps("Your Balance")}: ₹${user.balance.toFixed(2)}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        let taxPercent = ws ? ws.taxPercent : 0;
        let taxAmount = 0;
        let receiveAmount = amount;
        if (taxPercent > 0) { taxAmount = (amount * taxPercent) / 100; receiveAmount = amount - taxAmount; }
        let methodIcon = method === "upi" ? "⚡" : (method === "bank" ? "🏦" : (method === "amazon" ? "📧" : "🎁"));
        let methodLabel = method.toUpperCase();
        let bodyText = `${toSmallCaps("Amount")}: <code>${amount}</code> INR\n` +
          `${toSmallCaps("You receive")}: <code>${receiveAmount.toFixed(2)}</code> INR (Tax: <code>₹${taxAmount.toFixed(2)}</code>)\n\n` +
          `${methodIcon} ${methodLabel} ID: <code>${details}</code>`;
        let confirmMsg = `<b>${toSmallCaps("Withdrawal Confirmation")}</b>\n\n<blockquote>${bodyText}</blockquote>\n\n${toSmallCaps("Confirm your transaction by clicking Confirm")}`;
        userState[userId] = `MANUAL_CONFIRM_${method}_${amount}`;
        return ctx.reply(confirmMsg, {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text(makeBtn("Confirm ✅"), `man_conf_yes_${method}_${amount}`).row()
            .text(makeBtn("Cancel ❌"), `man_conf_no`)
        }).catch(() => { });
      }

      if (state === "WD_ADD_UPI") {
        let upi = text.trim();
        if (!validateUPI(upi)) return ctx.reply(`⛔️ <b>Invalid UPI/VPA Address</b>`, { parse_mode: "HTML" }).catch(() => { });
        delete userState[userId];
        let user = await getUser(userId);
        user.upiId = upi;
        await user.save();
        return ctx.reply(`✅ ${toSmallCaps("UPI Saved!")}\n\n📌 <code>${upi}</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "back_to_withdraw") }).catch(() => { });
      }

      if (state === "WD_ADD_BANK_ACCNO") {
        let accNo = text.trim();
        if (!validateBankAcc(accNo)) return ctx.reply(`⛔️ <b>Invalid Account Number</b>`, { parse_mode: "HTML" }).catch(() => { });
        userState[userId] = `WD_ADD_BANK_IFSC_${accNo}`;
        return ctx.reply(`✅ ${toSmallCaps("Account")}: <code>${accNo}</code>\n\n📝 ${toSmallCaps("Send IFSC Code")}:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "back_to_withdraw") }).catch(() => { });
      }

      if (state.startsWith("WD_ADD_BANK_IFSC_")) {
        let accNo = state.replace("WD_ADD_BANK_IFSC_", "");
        let ifsc = text.trim().toUpperCase();
        if (!validateIFSC(ifsc)) return ctx.reply(`⛔️ <b>Invalid IFSC Code</b>`, { parse_mode: "HTML" }).catch(() => { });
        delete userState[userId];
        let user = await getUser(userId);
        user.bankAccNo = accNo;
        user.bankIfsc = ifsc;
        await user.save();
        return ctx.reply(`✅ ${toSmallCaps("Bank Saved!")}\n\n🏦 <code>${accNo}</code>\n🔢 <code>${ifsc}</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "back_to_withdraw") }).catch(() => { });
      }

      if (state === "WD_ADD_AMAZON") {
        let email = text.trim();
        if (!email.includes("@")) return ctx.reply(`⛔️ <b>Invalid Email</b>`, { parse_mode: "HTML" }).catch(() => { });
        delete userState[userId];
        let user = await getUser(userId);
        user.amazonEmail = email;
        await user.save();
        return ctx.reply(`✅ ${toSmallCaps("Amazon Saved!")}\n\n📧 <code>${email}</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "back_to_withdraw") }).catch(() => { });
      }

      if (state === "WD_ADD_REDEEM") {
        let addr = text.trim();
        delete userState[userId];
        let user = await getUser(userId);
        user.redeemCodeAddr = addr;
        await user.save();
        return ctx.reply(`✅ ${toSmallCaps("Redeem Saved!")}\n\n🎁 <code>${addr}</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "back_to_withdraw") }).catch(() => { });
      }

      if (state === "QP_WAIT_INPUT") {
        delete userState[userId];
        let lines = text.trim().split("\n").map(l => l.trim()).filter(l => l !== "");
        if (lines.length === 0) return ctx.reply(`${toSmallCaps("No data provided!")}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (lines.length > 20) return ctx.reply(`${toSmallCaps("Maximum 20 payments at once!")}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        let parsed = [];
        let errors = [];
        for (let line of lines) {
          let parts = line.split(/\s+/).filter(p => p !== "");
          if (parts.length < 2) { errors.push(`${line} (invalid format)`); continue; }
          let userInput = parts[0].trim();
          let amt = parseFloat(parts[parts.length - 1]);
          if (isNaN(amt) || amt <= 0) { errors.push(`${line} (invalid amount)`); continue; }
          let receiver = null;
          if (/^\d+$/.test(userInput)) receiver = await User.findOne({ userId: parseInt(userInput, 10) }).lean();
          else if (userInput.startsWith("@")) {
            let cleanUsername = userInput.replace(/^@/, '').toLowerCase();
            receiver = await User.findOne({ username: { $regex: new RegExp("^" + cleanUsername + "$", "i") } }).lean();
          } else if (/^[a-zA-Z0-9_]{5,32}$/.test(userInput)) {
            let cleanUsername = userInput.toLowerCase();
            receiver = await User.findOne({ username: { $regex: new RegExp("^" + cleanUsername + "$", "i") } }).lean();
          }
          if (!receiver) { errors.push(`${userInput} (user not found)`); continue; }
          if (receiver.userId === userId) { errors.push(`${userInput} (cannot pay yourself)`); continue; }
          parsed.push({ receiver, amount: amt });
        }

        let aggregated = {};
        for (let p of parsed) {
          let uid = p.receiver.userId;
          if (aggregated[uid]) {
            aggregated[uid].amount += p.amount;
          } else {
            aggregated[uid] = { receiver: p.receiver, amount: p.amount };
          }
        }
        let finalPayments = Object.values(aggregated);

        if (errors.length > 0 && finalPayments.length === 0) return ctx.reply(`<b>${toSmallCaps("Errors")}</b>\n\n<blockquote>${errors.join("\n")}</blockquote>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Try Again"), "qp_retry") }).catch(() => { });
        if (finalPayments.length === 0) return ctx.reply(`${toSmallCaps("No valid payments!")}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });

        let totalAmount = finalPayments.reduce((sum, p) => sum + p.amount, 0);
        let sender = await getUser(userId);
        let isPrivileged = (await isAdmin(userId)) || (await isOwner(userId)) || (await isWhitelisted(userId));
        let unlimited = await getConfig("quick_pay_unlimited", true);
        let negativeAllowed = await getConfig("quick_pay_negative_balance", false);
        let skipBalance = isPrivileged && unlimited;
        if (!skipBalance && !negativeAllowed && sender.balance < totalAmount) return ctx.reply(`<b>${toSmallCaps("Insufficient Balance!")}</b>\n\n<blockquote>${toSmallCaps("Your")}: ₹${sender.balance.toFixed(2)}\n${toSmallCaps("Required")}: ₹${totalAmount.toFixed(2)}</blockquote>`, { parse_mode: "HTML", reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });

        global.quickPayCache = global.quickPayCache || {};
        global.quickPayCache[userId] = { payments: finalPayments };

        let bodyText = "";
        finalPayments.forEach((p, i) => {
          bodyText += `${i + 1}. ${p.receiver.firstName || "User"}\n`;
          bodyText += `${toSmallCaps("User ID")}: ${p.receiver.userId}\n`;
          bodyText += `${toSmallCaps("Username")}: ${p.receiver.username ? "@" + p.receiver.username : "None"}\n`;
          bodyText += `${toSmallCaps("Amount")}: ₹${p.amount}\n\n`;
        });
        bodyText += `${toSmallCaps("Total Users")}: ${finalPayments.length}\n${toSmallCaps("Total Amount")}: ₹${totalAmount.toFixed(2)}\n`;
        if (skipBalance) bodyText += `${toSmallCaps("Mode")}: 👑 Admin/Owner (Unlimited)\n`;
        else bodyText += `${toSmallCaps("Your Balance")}: ₹${sender.balance.toFixed(2)}\n${toSmallCaps("After")}: ₹${(sender.balance - totalAmount).toFixed(2)}`;
        userState[userId] = `QP_CONFIRM_MULTI`;
        return ctx.reply(`<b>${toSmallCaps("Confirm Payment")}</b>\n\n<blockquote>${bodyText}</blockquote>`, {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().text(makeBtn("Confirm ✅"), "qp_confirm_multi").row().text(makeBtn("Cancel ❌"), "qp_cancel")
        }).catch(() => { });
      }

      if (state.startsWith("QP_AMOUNT_")) {
        let targetId = parseInt(state.replace("QP_AMOUNT_", ""), 10);
        delete userState[userId];
        let amount = parseFloat(text);
        if (isNaN(amount) || amount <= 0) return ctx.reply(`❌ ${toSmallCaps("Invalid amount!")}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        let target = await User.findOne({ userId: targetId }).lean();
        if (!target) return ctx.reply(`❌ ${toSmallCaps("User not found")}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        let sender = await getUser(userId);
        let isPrivileged = (await isAdmin(userId)) || (await isOwner(userId)) || (await isWhitelisted(userId));
        let unlimited = await getConfig("quick_pay_unlimited", true);
        let negativeAllowed = await getConfig("quick_pay_negative_balance", false);
        let skipBalance = isPrivileged && unlimited;
        if (!skipBalance && !negativeAllowed && sender.balance < amount) return ctx.reply(`❌ ${toSmallCaps("Insufficient!")} ₹${sender.balance.toFixed(2)}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        global.quickPayCache = global.quickPayCache || {};
        global.quickPayCache[userId] = { payments: [{ receiver: target, amount }] };
        let bodyText = `${toSmallCaps("To")}: ${target.firstName || "User"}\n${toSmallCaps("User ID")}: ${target.userId}\n${toSmallCaps("Username")}: ${target.username ? "@" + target.username : "None"}\n${toSmallCaps("Amount")}: ₹${amount}\n\n${toSmallCaps("Your Balance")}: ₹${sender.balance.toFixed(2)}`;
        userState[userId] = "QP_CONFIRM_MULTI";
        return ctx.reply(`<b>${toSmallCaps("Confirm Payment")}</b>\n\n<blockquote>${bodyText}</blockquote>`, {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().text(makeBtn("Confirm ✅"), "qp_confirm_multi").row().text(makeBtn("Cancel ❌"), "qp_cancel")
        }).catch(() => { });
      }

      if (state === "WAITING_FOR_GIFT_REDEEM") {
        delete userState[userId];
        let gift = await GiftCode.findOneAndUpdate(
          { code: text, type: "redeem", usedUsers: { $ne: userId }, $expr: { $lt: [{ $size: "$usedUsers" }, "$maxUses"] } },
          { $push: { usedUsers: userId } }, { new: true }
        );
        if (!gift) return ctx.reply(`🚫 ${toSmallCaps("Invalid or expired!")}`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        let user = await getUser(userId);
        user.balance += gift.amount;
        await user.save();
        await logBalanceHistory(userId, `Gift Redeemed (${gift.code})`, gift.amount);
        return ctx.reply(`🎉 ${toSmallCaps("Gift redeemed!")} ${toSmallCaps("Added")} ₹${gift.amount}.`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
      }

      if (state.startsWith("TASK_REFER_")) {
        return;
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
        if (!tasks || tasks.length === 0) return ctx.reply(`${toSmallCaps("No tasks available.")}`, { parse_mode: "HTML" }).catch(() => { });
        let taskButtons = [];
        tasks.forEach(t => taskButtons.push([{ text: `${t.title} (₹${t.reward})`, callback_data: `do_task_${t.taskId}` }]));
        return ctx.reply(`<b>${toSmallCaps("Available Tasks")}</b>`, { reply_markup: await buildStyledKb(taskButtons), parse_mode: "HTML" }).catch(() => { });
      } catch (e) { return ctx.reply(`❌ ${toSmallCaps("Error loading tasks.")}`, { parse_mode: "HTML" }).catch(() => { }); }
    }
    else if (matchedKey === "btn_gift") {
      userState[userId] = "WAITING_FOR_GIFT_REDEEM";
      return ctx.reply(`🎁 ${toSmallCaps("Gift Code")}\n\n${toSmallCaps("Send Gift Code To Claim Reward!")}`, { parse_mode: "HTML" }).catch(() => { });
    }
    else if (matchedKey === "btn_quickpay") {
      const { Keyboard } = require("grammy");
      let qpEnabled = await getConfig("quick_pay_enabled", true);
      if (!qpEnabled) return ctx.reply(`⚠️ ${toSmallCaps("Quick Pay is currently disabled.")}`, { parse_mode: "HTML" }).catch(() => { });
      let title = `💡${toSmallCaps("Quick Pay To a Simple User Payment Send")}`;
      let openingUsername = ctx.from.username ? `@${ctx.from.username}` : "No Username";
      let adminId = await getConfig("owner_id", MAIN_OWNER_ID);
      let bodyText = `${toSmallCaps("You Can Also Use The Format Below To Process Payments For One or Multiple Users:")}\n\n${toSmallCaps("Format")} :\n<code>${userId} 5</code>     <code>${openingUsername} 5</code>\n<code>${adminId} 10</code>     <code>@username 10</code>`;
      let qpText = `${title}\n\n<blockquote>${bodyText}</blockquote>`;
      userState[userId] = "QP_WAIT_INPUT";
      let kb = new Keyboard().requestUsers(`${toSmallCaps("Select User")}`, 1, { user_is_bot: false, request_name: true, request_username: true }).row().text("❌ Cancel").resized();
      return ctx.reply(qpText, { parse_mode: "HTML", reply_markup: kb }).catch(() => { });
    }
    else if (matchedKey === "btn_payout") {
      return sendPayoutMethodPage(ctx, false);
    }
    else if (matchedKey === "btn_withdraw") {
      let withdrawEnabled = await getConfig("withdraw_enabled", true);
      if (!withdrawEnabled) {
        let isAdminU = await isAdmin(userId);
        if (!isAdminU) return ctx.reply(`⚠️ ${toSmallCaps("Withdrawals are currently disabled")}`, { parse_mode: "HTML" }).catch(() => { });
      }
      let buttons = await buildWithdrawMenu();
      if (buttons.length === 0) return ctx.reply(`<b>${toSmallCaps("Choose Withdraw Method")}</b>\n\n❌ ${toSmallCaps("No withdraw methods available.")}`, { parse_mode: "HTML" }).catch(() => { });
      userState[userId] = "AWAITING_WITHDRAW_METHOD";
      return ctx.reply(`<b>${toSmallCaps("Choose Withdraw Method")}</b>`, { reply_markup: await buildStyledKb(buttons), parse_mode: "HTML" }).catch(() => { });
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
        return ctx.reply(`🎉 ${toSmallCaps("Added")} ₹${gift.amount}!`, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
      }
      return sendUnknownCommand(ctx);
    }
  } catch (e) {
    console.error("message:text error:", e.message);
  }
});

bot.command("admin", async (ctx) => {
  let userId = ctx.from.id;
  let disabled = await isAdminDisabled(userId);
  if (disabled) {
    let ownerId = await getConfig("owner_id", MAIN_OWNER_ID);
    let ownerUser = await User.findOne({ userId: ownerId }).lean();
    let ownerName = ownerUser ? (ownerUser.firstName || "Owner") : "Owner";
    return ctx.reply(
      `❌ <b>${toSmallCaps("ADMIN ACCESS DISABLED")}</b>\n\n${toSmallCaps("Your admin permissions have been disabled by the Owner.")}\n\n📞 ${toSmallCaps("Contact Owner")}: ${ownerName}\n🆔 ${toSmallCaps("Owner ID")}: ${ownerId}`,
      { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(`${toSmallCaps("Back to Main Menu")}`, "back_to_balance") }
    ).catch(() => { });
  }
  if (!(await isAdmin(userId))) return ctx.reply(`❌ ${toSmallCaps("Not an admin!")}`, { parse_mode: "HTML" }).catch(() => { });
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
  if (botStatus === "active") statusDisplay = `✅ Active`;
  else if (botStatus === "maintenance") statusDisplay = `⚠️ Maintenance`;
  else statusDisplay = `❌ Disabled`;

  let minW = await getConfig("min_withdraw", 0);
  let maxW = await getConfig("max_withdraw", 0);
  let pChannel = await getConfig("payout_channel", null);
  if (!pChannel || pChannel === "Not Set") {
    for (let m of ["upi", "bank", "wallet", "amazon", "redeem"]) {
      let oldCh = await getConfig("payout_channel_" + m, null);
      if (oldCh && oldCh !== "Not Set") { pChannel = oldCh; break; }
    }
  }
  if (!pChannel) pChannel = "Not Set";
  let supportId = await getConfig("support_username", "Not Set");
  let quickTaxEnabled = await getConfig("quick_pay_enabled", true);
  let quickTaxPercent = await getConfig("quick_pay_tax_percent", 0);

  let panelText =
    `👑 <b>Admin Panel</b>\n\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🤖 <b>Bot Status:</b> ${statusDisplay}\n` +
    `💸 <b>Min:</b> ₹${minW} | 💰 <b>Max:</b> ₹${maxW}\n` +
    `📢 <b>Payout:</b> <code>${pChannel}</code>\n` +
    `💬 <b>Support:</b> <code>${supportId}</code>\n` +
    `🌐 <b>Gateways:</b> ${gatewayCount} active\n` +
    `⚡ <b>Quick Pay:</b> ${quickTaxEnabled ? `🟢 ON` : "🔴 OFF"} (Tax: ${quickTaxPercent}%)\n` +
    `👥 <b>Users:</b> ${userCount} | 👑 <b>Admins:</b> ${activeAdmins}\n\n` +
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

  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(panelText, { reply_markup: styledKb, parse_mode: "HTML" }).catch(() => { });
  } else {
    await ctx.reply(panelText, { reply_markup: styledKb, parse_mode: "HTML" }).catch(() => { });
  }
}

bot.callbackQuery("admin", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  delete userState[ctx.from.id];
  await sendAdminPanel(ctx, true);
});

bot.callbackQuery("adm_permissions", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderPermissionsPanel(ctx);
});

async function renderPermissionsPanel(ctx) {
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  const ownerId = await getConfig("owner_id", MAIN_OWNER_ID);
  const ownerUser = await User.findOne({ userId: ownerId }).lean();
  const admins = await BotAdmin.find({}).sort({ addedAt: -1 }).lean();
  let bodyText = `👑 <b>Owner:</b> ${ownerUser?.firstName || "Owner"}\n🆔 <code>${ownerId}</code>\n\n📊 Total Admins: ${admins.length}\n\n👇 Click to toggle / remove:`;
  let text = `<b>Admin Permissions</b>\n\n<blockquote>${bodyText}</blockquote>`;
  let kb = new InlineKeyboard();
  for (let a of admins) {
    let u = await User.findOne({ userId: a.userId }).lean();
    let name = u ? (u.firstName || "User") : "Unknown";
    let status = a.isActive ? "🟢" : "🔴";
    kb.text(`${status} ${name} — ${a.userId}`, `adm_perm_toggle_${a.userId}`).row();
    kb.text(makeBtn("Remove"), `adm_perm_remove_${a.userId}`).row();
  }
  kb.text(makeBtn("Add New Admin"), "admin_add").row();
  kb.text(makeBtn("Back to Admin"), "admin");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery(/^adm_perm_toggle_/, async (ctx) => {
  if (!(await isOwner(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Owner only!", show_alert: true }).catch(() => { });
  let adminId = parseInt(ctx.callbackQuery.data.replace("adm_perm_toggle_", ""), 10);
  let admin = await BotAdmin.findOne({ userId: adminId });
  if (!admin) return ctx.answerCallbackQuery({ text: "Not found", show_alert: true }).catch(() => { });
  admin.isActive = !admin.isActive;
  if (!admin.isActive) { admin.disabledAt = new Date(); admin.disabledBy = ctx.from.id; }
  else { admin.disabledAt = null; admin.disabledBy = null; }
  await admin.save();
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Owner", admin.isActive ? "Admin Enabled" : "Admin Disabled", `${adminId}`, 0, adminId);
  await ctx.answerCallbackQuery({ text: admin.isActive ? "🟢 Enabled" : "🔴 Disabled" }).catch(() => { });
  await renderPermissionsPanel(ctx);
});

bot.callbackQuery(/^adm_perm_remove_/, async (ctx) => {
  if (!(await isOwner(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Owner only!", show_alert: true }).catch(() => { });
  let adminId = parseInt(ctx.callbackQuery.data.replace("adm_perm_remove_", ""), 10);
  await BotAdmin.deleteOne({ userId: adminId });
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Owner", "Admin Removed", `${adminId}`, 0, adminId);
  await ctx.answerCallbackQuery({ text: "Removed!" }).catch(() => { });
  await renderPermissionsPanel(ctx);
});

bot.callbackQuery("admin_add", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isOwner(ctx.from.id))) return;
  userState[ctx.from.id] = "WAITING_ADMIN_ADD";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Add New Admin</b>\n\n📝 Send User ID or @username:\n\nExample:\n<code>123456789</code>\n<code>@username</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_permissions") }).catch(() => { });
});

bot.callbackQuery("adm_transfer", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isOwner(ctx.from.id))) return;
  userState[ctx.from.id] = "WAITING_NEW_OWNER";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Transfer Ownership</b>\n\n⚠️ You will become an Admin.\n\n📝 Send new Owner User ID:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "admin") }).catch(() => { });
});

bot.callbackQuery(/^admin_transfer_confirm_/, async (ctx) => {
  if (!(await isOwner(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let newOwnerId = parseInt(ctx.callbackQuery.data.replace("admin_transfer_confirm_", ""), 10);
  if (isNaN(newOwnerId)) return;
  let targetUser = await User.findOne({ userId: newOwnerId });
  if (!targetUser) return ctx.answerCallbackQuery({ text: "User not found!", show_alert: true }).catch(() => { });
  await BotAdmin.findOneAndUpdate({ userId: ctx.from.id }, { addedAt: new Date(), addedBy: ctx.from.id, isActive: true }, { upsert: true });
  await setConfig("owner_id", newOwnerId);
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Owner", "Ownership Transferred", `New owner: ${newOwnerId}`, 0, newOwnerId);
  try { await ctx.api.sendMessage(newOwnerId, `👑 <b>Congratulations!</b>\nYou are now the OWNER of this bot!\n\nFull control granted.`, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
  await ctx.answerCallbackQuery({ text: "✅ Transferred!" }).catch(() => { });
  await sendAdminPanel(ctx, true);
});

bot.callbackQuery("adm_set_wd_tax", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let cur = await getConfig("tax_percent", 0);
  let kb = new InlineKeyboard()
    .text(makeBtn("Set Tax %"), "adm_set_tax_val").row()
    .text(makeBtn("Reset to 0%"), "adm_reset_tax").row()
    .text(makeBtn("Back"), "admin");
  await ctx.editMessageText(`<b>Set Withdraw Tax</b>\n\n📊 Current: <code>${cur}%</code>\n\n👇 Choose action:`, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_set_tax_val", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "WAITING_TAX_PERCENT";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`📝 Send tax percentage (0-50):`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_set_wd_tax") }).catch(() => { });
});

bot.callbackQuery("adm_reset_tax", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  await setConfig("tax_percent", 0);
  await ctx.answerCallbackQuery({ text: "Reset!" }).catch(() => { });
  await rerender(ctx, "adm_set_wd_tax");
});

async function rerender(ctx, callbackData) {
  try {
    const msg = ctx.callbackQuery?.message || ctx.message;
    if (!msg || !msg.chat) return;
    const fakeUpdate = {
      update_id: Date.now() + Math.floor(Math.random() * 100000),
      callback_query: {
        id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        from: ctx.from,
        chat_instance: "rerender",
        data: callbackData,
        message: msg
      }
    };
    await bot.handleUpdate(fakeUpdate);
  } catch (e) { }
}

bot.callbackQuery("adm_bot_status", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let current = await getConfig("bot_status", "active");
  let next = current === "active" ? "maintenance" : current === "maintenance" ? "disabled" : "active";
  await setConfig("bot_status", next);
  await setConfig("bot_active", next === "active");
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Bot Status Changed", `${current} → ${next}`, 0, null);
  let toastMsg = next === "active" ? "✅ Active" : next === "maintenance" ? "⚠️ Maintenance" : "❌ Disabled";
  await ctx.answerCallbackQuery({ text: toastMsg }).catch(() => { });
  await sendAdminPanel(ctx, true);
});

bot.callbackQuery("adm_admins", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderPermissionsPanel(ctx);
});

bot.callbackQuery("adm_manage_ban", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let bannedUsers = await User.find({ isBanned: true }).limit(20).lean();
  let bodyText = `Total Banned: ${bannedUsers.length}\n\n`;
  bannedUsers.forEach((u, i) => { bodyText += `${i + 1}. ${u.firstName || "User"} — <code>${u.userId}</code>\n`; });
  let kb = new InlineKeyboard().text(makeBtn("Ban New User"), "adm_ban_new").row().text(makeBtn("Unban User"), "adm_unban_user").row().text(makeBtn("Back"), "admin");
  await ctx.editMessageText(`<b>Manage Ban Users</b>\n\n<blockquote>${bodyText}</blockquote>`, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_ban_new", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "BAN_USER_WAIT";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`🚫 Send User ID to BAN:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_manage_ban") }).catch(() => { });
});

bot.callbackQuery("adm_unban_user", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "UNBAN_USER_WAIT";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`🔓 Send User ID to UNBAN:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_manage_ban") }).catch(() => { });
});

bot.callbackQuery("adm_manage_ban_wallet", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let unlimitedWallet = await getConfig("unlimited_wallet", false);
  let onetimeWallet = await getConfig("onetime_wallet", false);
  let text = `<b>Manage Ban Wallet</b>\n\n♾️ Unlimited: ${unlimitedWallet ? "🟢 ON" : "🔴 OFF"}\n⏱️ One-Time: ${onetimeWallet ? "🟢 ON" : "🔴 OFF"}`;
  let kb = new InlineKeyboard().text(makeBtn("Ban Wallet"), "adm_ban_wallet").row().text(makeBtn(unlimitedWallet ? "Unlimited: ON" : "Unlimited: OFF"), "adm_unlimited_wallet").row().text(makeBtn(onetimeWallet ? "One-Time: ON" : "One-Time: OFF"), "adm_onetime_wallet").row().text(makeBtn("Back"), "admin");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_ban_wallet", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "BAN_WALLET_WAIT";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`🚫 Send Wallet ID to BAN:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_manage_ban_wallet") }).catch(() => { });
});

bot.callbackQuery("adm_unlimited_wallet", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let cur = await getConfig("unlimited_wallet", false);
  await setConfig("unlimited_wallet", !cur);
  await ctx.answerCallbackQuery({ text: !cur ? "ON" : "OFF" }).catch(() => { });
  await rerender(ctx, "adm_manage_ban_wallet");
});

bot.callbackQuery("adm_onetime_wallet", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let cur = await getConfig("onetime_wallet", false);
  await setConfig("onetime_wallet", !cur);
  await ctx.answerCallbackQuery({ text: !cur ? "ON" : "OFF" }).catch(() => { });
  await rerender(ctx, "adm_manage_ban_wallet");
});

bot.callbackQuery("adm_wd_status", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let isEnabled = await getConfig("withdraw_enabled", true);
  let status = isEnabled ? "ON" : "OFF";
  let desc = isEnabled ? "All users can request withdrawals." : "All withdrawal requests disabled.";
  let text = `<b>Withdraw Status</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nGlobal Withdraw: <b>${status}</b>\n\n${desc}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  let kb = new InlineKeyboard().text(makeBtn(isEnabled ? "Turn OFF" : "Turn ON"), "toggle_withdraw_global").row().text(makeBtn("Back"), "admin");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("toggle_withdraw_global", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let current = await getConfig("withdraw_enabled", true);
  await setConfig("withdraw_enabled", !current);
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", !current ? "Withdraw Enabled" : "Withdraw Disabled", "", 0, null);
  await ctx.answerCallbackQuery({ text: !current ? "ON" : "OFF" }).catch(() => { });
  await rerender(ctx, "adm_wd_status");
});

bot.callbackQuery("adm_add_bal", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "WAITING_FOR_ADD_BAL";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`➕ <b>Add Balance</b>\n\n📝 Send:\n<code>UserID Amount</code>\n<code>@username Amount</code>\n\n💡 Example:\n<code>8061612320 100</code>\n<code>@myfriend 50</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "admin") }).catch(() => { });
});

bot.callbackQuery("adm_rem_bal", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "WAITING_FOR_REM_BAL";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`➖ <b>Remove Balance</b>\n\n📝 Send:\n<code>UserID Amount</code>\n<code>@username Amount</code>\n\n💡 Example:\n<code>8061612320 100</code>\n<code>@myfriend 50</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "admin") }).catch(() => { });
});

bot.callbackQuery("adm_reset_all_bal", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let userCount = await User.countDocuments({});
  let kb = new InlineKeyboard().text(makeBtn("Yes, Reset All"), "adm_reset_all_confirm").row().text(makeBtn("Cancel"), "admin");
  await ctx.editMessageText(`⚠️ <b>RESET ALL BALANCES</b>\n\nUsers: ${userCount}\n\nThis will reset EVERYONE's balance to 0!\n\nConfirm?`, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_reset_all_confirm", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  await ctx.answerCallbackQuery({ text: "Resetting..." }).catch(() => { });
  await User.updateMany({}, { $set: { balance: 0, withdrawnTotal: 0 } });
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Reset All Balances", "All users", 0, null);
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`All balances reset to 0`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "admin") }).catch(() => { });
});

bot.callbackQuery("adm_talk_user", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "WAITING_FOR_USER_MESSAGE";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`💬 Format: <code>UserID | Message</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "admin") }).catch(() => { });
});

bot.callbackQuery("adm_find_user", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "WAITING_FOR_TRACKER_ID";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Find User Details</b>\n\n📝 Send User ID:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "admin") }).catch(() => { });
});

bot.callbackQuery(/^user_detail_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let uid = parseInt(ctx.callbackQuery.data.replace("user_detail_", ""), 10);
  let u = await User.findOne({ userId: uid }).lean();
  if (!u) return;
  let approvedCount = await Withdrawal.countDocuments({ userId: uid, status: "Approved" });
  let totalWdArr = await Withdrawal.aggregate([{ $match: { userId: uid, status: "Approved" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]);
  let totalWd = totalWdArr[0]?.total || 0;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let bodyText = `Name: ${u.firstName || "User"}\nID: ${uid}\nUsername: ${u.username ? "@" + u.username : "None"}\n\nBalance: ${formatBalance(u.balance)}\nTotal Withdrawn: ₹${totalWd.toFixed(2)}\nWithdraw Count: ${approvedCount}\n\nJoined: ${formatDateTime(u.createdAt)}`;
  let text = `<b>User Details</b>\n\n<blockquote>${bodyText}</blockquote>`;
  let kb = new InlineKeyboard()
    .text(makeBtn("Linked Withdraw"), `user_linked_${uid}`).row()
    .text(makeBtn("Withdraw History"), `user_wd_hist_${uid}`).row()
    .text(makeBtn("Balance History"), `user_bal_hist_${uid}`).row()
    .text(makeBtn("Add Balance"), `user_add_bal_${uid}`).text(makeBtn("Remove Balance"), `user_rem_bal_${uid}`).row()
    .text(makeBtn("Send Message"), `user_send_msg_${uid}`).text(makeBtn("Ban/Unban"), `user_ban_${uid}`).row()
    .text(makeBtn("Back"), "admin");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^user_linked_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  let uid = parseInt(ctx.callbackQuery.data.replace("user_linked_", ""), 10);
  let u = await User.findOne({ userId: uid }).lean();
  if (!u) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let bodyText = `Wallet Number: ${u.walletNumber || "Not Set"}\n\nUPI: ${u.upiId || "Not Set"}\n\nBank: ${u.bankAccNo || "Not Set"}\n\nAmazon: ${u.amazonEmail || "Not Set"}\n\nRedeem: ${u.redeemCodeAddr || "Not Set"}`;
  await ctx.editMessageText(`<b>Linked Withdraw Methods</b>\n\n<blockquote>${bodyText}</blockquote>`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), `user_detail_${uid}`), parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^user_wd_hist_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  let uid = parseInt(ctx.callbackQuery.data.replace("user_wd_hist_", ""), 10);
  let withdrawals = await Withdrawal.find({ userId: uid }).sort({ createdAt: -1 }).limit(10).lean();
  let totalArr = await Withdrawal.aggregate([{ $match: { userId: uid, status: "Approved" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]);
  let total = totalArr[0]?.total || 0;
  let approved = await Withdrawal.countDocuments({ userId: uid, status: "Approved" });
  let pending = await Withdrawal.countDocuments({ userId: uid, status: "Pending" });
  let rejected = await Withdrawal.countDocuments({ userId: uid, status: "Rejected" });
  let bodyText = `Total: ₹${total.toFixed(2)}\n✅ ${approved} | ⏳ ${pending} | ❌ ${rejected}\n\n`;
  if (withdrawals.length === 0) bodyText += `No withdrawals`;
  else withdrawals.forEach((w, i) => { let icon = w.status === "Approved" ? "✅" : (w.status === "Rejected" ? "❌" : "⏳"); bodyText += `${i + 1}. ${icon} ₹${w.amount} — ${w.method}\n${formatDateTime(w.createdAt)}\n\n`; });
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Withdraw History</b>\n\n<blockquote>${bodyText}</blockquote>`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), `user_detail_${uid}`), parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^user_bal_hist_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  let uid = parseInt(ctx.callbackQuery.data.replace("user_bal_hist_", ""), 10);
  let history = await BalanceHistory.find({ userId: uid }).sort({ createdAt: -1 }).limit(15).lean();
  let u = await User.findOne({ userId: uid }).lean();
  let totalIn = 0, totalOut = 0;
  history.forEach(h => { if (h.amount >= 0) totalIn += h.amount; else totalOut += Math.abs(h.amount); });
  let bodyText = `🟢 Credited: ₹${totalIn.toFixed(2)}\n🔴 Debited: ₹${totalOut.toFixed(2)}\n💵 Current: ${formatBalance(u?.balance || 0)}\n\n`;
  if (history.length === 0) bodyText += `No transactions`;
  else history.forEach((h, i) => { let icon = h.amount >= 0 ? "🟢" : "🔴"; let sign = h.amount >= 0 ? "+" : ""; bodyText += `${i + 1}. ${icon} ${h.action}\n   ${sign}₹${h.amount.toFixed(2)}\n${formatDateTime(h.createdAt)}\n\n`; });
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Balance History</b>\n\n<blockquote>${bodyText}</blockquote>`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), `user_detail_${uid}`), parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^user_add_bal_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  let uid = parseInt(ctx.callbackQuery.data.replace("user_add_bal_", ""), 10);
  userState[ctx.from.id] = `UADD_WAIT_${uid}`;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`➕ Send amount to add to <code>${uid}</code>:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), `user_detail_${uid}`) }).catch(() => { });
});

bot.callbackQuery(/^user_rem_bal_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  let uid = parseInt(ctx.callbackQuery.data.replace("user_rem_bal_", ""), 10);
  userState[ctx.from.id] = `UREM_WAIT_${uid}`;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`➖ Send amount to remove from <code>${uid}</code>:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), `user_detail_${uid}`) }).catch(() => { });
});

bot.callbackQuery(/^user_send_msg_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  let uid = parseInt(ctx.callbackQuery.data.replace("user_send_msg_", ""), 10);
  userState[ctx.from.id] = `UMSG_WAIT_${uid}`;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`💬 Send message to <code>${uid}</code>:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), `user_detail_${uid}`) }).catch(() => { });
});

bot.callbackQuery(/^user_ban_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  let uid = parseInt(ctx.callbackQuery.data.replace("user_ban_", ""), 10);
  let u = await User.findOne({ userId: uid });
  if (!u) return;
  u.isBanned = !u.isBanned;
  await u.save();
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", u.isBanned ? "User Banned" : "User Unbanned", `${uid}`, 0, uid);
  await ctx.answerCallbackQuery({ text: u.isBanned ? "Banned" : "Unbanned" }).catch(() => { });
  await rerender(ctx, `user_detail_${uid}`);
});

bot.callbackQuery("adm_manage_channels", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderManageChannels(ctx);
});

async function renderManageChannels(ctx) {
  const pad = "\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let channels = await Channel.find({ isActive: true }).sort({ order: 1, addedAt: 1 }).lean();
  let socialLinks = await SocialLink.find({}).lean();
  let bannedAllowed = await getConfig("banned_in_channel_allowed", true);
  let nonAdminBypass = await getConfig("non_admin_channels_bypass", true);
  let showMode = await getConfig("show_mode", "all");
  let text = `📢 <b>Here You Can Manage Your Channels And Social Links</b>\n\nClick On A Channel Or Social Link To Set An Invite Link For Private Channels And Edit Social Link.`;
  let kb = new InlineKeyboard();
  for (let ch of channels) {
    let shortName = (ch.displayName || ch.channelId).substring(0, 8);
    let visibility = ch.isHidden ? "🙈" : "👀";
    kb.text(shortName, `ch_edit_${ch.channelId}`).text("❌", `ch_del_${ch.channelId}`).text("▲", `ch_up_${ch.channelId}`).text("▼", `ch_down_${ch.channelId}`).text(visibility, `ch_toggle_${ch.channelId}`).row();
  }
  for (let s of socialLinks) {
    let shortName = s.name.substring(0, 10);
    kb.text(shortName, `sl_edit_${s._id}`).text("❌", `sl_del_${s._id}`).row();
  }
  kb.text(makeBtn("➕ Add Channels"), "adm_add_channel").row()
    .text(makeBtn("➕ Add Payout Channel"), "adm_add_payout_channel").row()
    .text(makeBtn("➕ Add Social Media Links"), "adm_add_social_link").row()
    .text(makeBtn("📢 Broadcast To Channels"), "adm_broadcast_channels").row()
    .text(makeBtn("⚡ New User Join Channels"), "adm_new_user_join").row()
    .text(makeBtn(`🛡 Banned In Channel ~ ${bannedAllowed ? "✅ Allowed" : "❌ Not Allowed"}`), "adm_banned_in_channel").row()
    .text(makeBtn(`⚙ Non-Admin Channels ~ ${nonAdminBypass ? "🟢 Bypass" : "🔴 Not Bypass"}`), "adm_non_admin_channels").row()
    .text(makeBtn(`⚪ Show Mode: ${showMode === "all" ? "All Channels" : "Not Joined Only"}`), "adm_show_mode").row()
    .text(makeBtn("Back"), "admin");
  if (ctx.callbackQuery) await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
  else await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("adm_add_channel", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "ADD_CHANNEL_WAIT";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Add Channel</b>\n\nSend Your Channel User Name:\n\nExample:\n@mychannel\n-1001234567890`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_manage_channels") }).catch(() => { });
});

bot.callbackQuery(/^ch_del_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let chId = ctx.callbackQuery.data.replace("ch_del_", "");
  await Channel.deleteOne({ channelId: chId });
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Channel Deleted", chId, 0, null);
  await ctx.answerCallbackQuery({ text: "Removed!" }).catch(() => { });
  await renderManageChannels(ctx);
});

bot.callbackQuery(/^ch_up_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let chId = ctx.callbackQuery.data.replace("ch_up_", "");
  let channels = await Channel.find({ isActive: true }).sort({ order: 1, addedAt: 1 }).lean();
  let idx = channels.findIndex(c => c.channelId === chId);
  if (idx > 0) {
    let currOrder = channels[idx].order || idx;
    let prevOrder = channels[idx - 1].order || (idx - 1);
    await Channel.updateOne({ channelId: chId }, { order: prevOrder });
    await Channel.updateOne({ channelId: channels[idx - 1].channelId }, { order: currOrder });
  }
  await ctx.answerCallbackQuery({ text: "⬆️" }).catch(() => { });
  await renderManageChannels(ctx);
});

bot.callbackQuery(/^ch_down_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let chId = ctx.callbackQuery.data.replace("ch_down_", "");
  let channels = await Channel.find({ isActive: true }).sort({ order: 1, addedAt: 1 }).lean();
  let idx = channels.findIndex(c => c.channelId === chId);
  if (idx < channels.length - 1) {
    let currOrder = channels[idx].order || idx;
    let nextOrder = channels[idx + 1].order || (idx + 1);
    await Channel.updateOne({ channelId: chId }, { order: nextOrder });
    await Channel.updateOne({ channelId: channels[idx + 1].channelId }, { order: currOrder });
  }
  await ctx.answerCallbackQuery({ text: "⬇️" }).catch(() => { });
  await renderManageChannels(ctx);
});

bot.callbackQuery(/^ch_toggle_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let chId = ctx.callbackQuery.data.replace("ch_toggle_", "");
  let ch = await Channel.findOne({ channelId: chId });
  if (!ch) return;
  ch.isHidden = !ch.isHidden;
  await ch.save();
  await ctx.answerCallbackQuery({ text: ch.isHidden ? "🙈 Hidden" : "👀 Visible" }).catch(() => { });
  await renderManageChannels(ctx);
});

bot.callbackQuery(/^ch_edit_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let chId = ctx.callbackQuery.data.replace("ch_edit_", "");
  let ch = await Channel.findOne({ channelId: chId }).lean();
  if (!ch) return;
  userState[ctx.from.id] = `CH_EDIT_LINK_${chId}`;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Edit Channel</b>\n\nChannel: ${ch.displayName || ch.channelId}\nCurrent Link: ${ch.inviteLink}\n\nSend new invite link:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_manage_channels") }).catch(() => { });
});

bot.callbackQuery("adm_add_payout_channel", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let current = await getConfig("payout_channel", null);
  if (!current || current === "Not Set") {
    for (let m of ["upi", "bank", "wallet", "amazon", "redeem"]) {
      let oldCh = await getConfig("payout_channel_" + m, null);
      if (oldCh && oldCh !== "Not Set") { current = oldCh; break; }
    }
  }
  if (!current) current = "Not Set";
  userState[ctx.from.id] = "SET_PAYOUT_CHANNEL";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Set Payout Channel</b>\n\nCurrent: <code>${current}</code>\n\nSend Your Payout Channel Link\n\nExample:\n@upi_payouts\n-1001234567890`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel ❌"), "adm_manage_channels") }).catch(() => { });
});

bot.callbackQuery("adm_add_social_link", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "ADD_SOCIAL_LINK";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Add Social Media Link</b>\n\nFormat: <code>Name | Link</code>\n\nExample:\n<code>Instagram | https://instagram.com/username</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_manage_channels") }).catch(() => { });
});

bot.callbackQuery(/^sl_del_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let id = ctx.callbackQuery.data.replace("sl_del_", "");
  await SocialLink.deleteOne({ _id: id });
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Social Link Deleted", id, 0, null);
  await ctx.answerCallbackQuery({ text: "Removed!" }).catch(() => { });
  await renderManageChannels(ctx);
});

bot.callbackQuery(/^sl_edit_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let id = ctx.callbackQuery.data.replace("sl_edit_", "");
  let s = await SocialLink.findById(id).lean();
  if (!s) return;
  userState[ctx.from.id] = `SL_EDIT_${id}`;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Edit Social Link</b>\n\nCurrent: ${s.name} | ${s.link}\n\nSend new: <code>Name | Link</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_manage_channels") }).catch(() => { });
});

bot.callbackQuery("adm_broadcast_channels", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let channels = await Channel.find({ isActive: true }).lean();
  if (channels.length === 0) return ctx.answerCallbackQuery({ text: "No channels added!", show_alert: true }).catch(() => { });
  userState[ctx.from.id] = "BROADCAST_TO_CHANNELS";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let bodyText = `Total: ${channels.length} channels`;
  await ctx.editMessageText(`<b>Broadcast To Channels</b>\n\n<blockquote>${bodyText}</blockquote>\n\nSend your broadcast message:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_manage_channels") }).catch(() => { });
});

bot.callbackQuery("adm_new_user_join", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let channels = await Channel.find({ isActive: true }).sort({ order: 1 }).lean();
  let totalUsers = await User.countDocuments({});
  let forceJoinEnabled = await getConfig("force_join_enabled", true);
  let bodyText = `Bot Total Users: ${totalUsers}\nForce Join: ${forceJoinEnabled ? "ON" : "OFF"}\n\n`;
  let kb = new InlineKeyboard();
  for (let ch of channels) {
    let joinedCount = await User.countDocuments({ joinedChannels: ch.channelId });
    bodyText += `${ch.displayName || ch.channelId}: ${joinedCount}\n`;
    kb.text(makeBtn(`${ch.displayName || ch.channelId} (${joinedCount})`), `nuj_ch_${ch.channelId}`).row();
  }
  kb.text(makeBtn(forceJoinEnabled ? "Turn OFF Force Join" : "Turn ON Force Join"), "adm_toggle_force_join").row();
  kb.text(makeBtn("Back"), "adm_manage_channels");
  await ctx.editMessageText(`<b>New User Join Channels</b>\n\n<blockquote>${bodyText}</blockquote>`, { parse_mode: "HTML", reply_markup: kb }).catch(() => { });
});

bot.callbackQuery(/^nuj_ch_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let chId = ctx.callbackQuery.data.replace("nuj_ch_", "");
  let ch = await Channel.findOne({ channelId: chId }).lean();
  if (!ch) return;
  let users = await User.find({ joinedChannels: chId }).limit(50).lean();
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let bodyText = `Channel: ${ch.displayName || chId}\nJoined Users: ${users.length}\n\n`;
  users.forEach((u, i) => { bodyText += `${i + 1}. ${u.firstName || "User"} — <code>${u.userId}</code>\n`; });
  await ctx.editMessageText(`<b>Channel Joined Users</b>\n\n<blockquote>${bodyText}</blockquote>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_new_user_join") }).catch(() => { });
});

bot.callbackQuery("adm_toggle_force_join", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let cur = await getConfig("force_join_enabled", true);
  await setConfig("force_join_enabled", !cur);
  await ctx.answerCallbackQuery({ text: !cur ? "ON" : "OFF" }).catch(() => { });
  await rerender(ctx, "adm_new_user_join");
});

bot.callbackQuery("adm_banned_in_channel", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let cur = await getConfig("banned_in_channel_allowed", true);
  await setConfig("banned_in_channel_allowed", !cur);
  await ctx.answerCallbackQuery({ text: !cur ? "Allowed" : "Not Allowed" }).catch(() => { });
  await renderManageChannels(ctx);
});

bot.callbackQuery("adm_non_admin_channels", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let cur = await getConfig("non_admin_channels_bypass", true);
  await setConfig("non_admin_channels_bypass", !cur);
  await ctx.answerCallbackQuery({ text: !cur ? "Bypass" : "Not Bypass" }).catch(() => { });
  await renderManageChannels(ctx);
});

bot.callbackQuery("adm_show_mode", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let cur = await getConfig("show_mode", "all");
  await setConfig("show_mode", cur === "all" ? "not_joined" : "all");
  await ctx.answerCallbackQuery({ text: cur === "all" ? "Not Joined Only" : "All Channels" }).catch(() => { });
  await renderManageChannels(ctx);
});

// ==================== WITHDRAWAL STEP ====================
bot.callbackQuery("adm_gateway_menu", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderWithdrawalStep(ctx);
});

async function renderWithdrawalStep(ctx) {
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let text = `🚀 <b>Withdrawal Step</b>\n\nChoose withdrawal method:`;
  let kb = new InlineKeyboard()
    .text(makeBtn("🌐 Gateway"), "adm_gateway_list").row()
    .text(makeBtn("⚡ Auto UPI"), "adm_auto_upi").row()
    .text(makeBtn("Back to Admin"), "admin");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("adm_gateway_list", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderGatewayMenu(ctx);
});

// ==================== EXISTING GATEWAY (UNCHANGED) ====================
async function renderGatewayMenu(ctx) {
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let gateways = await Gateway.find({}).sort({ createdAt: -1 }).lean();
  let total = gateways.length;
  let active = gateways.filter(g => g.isActive).length;
  let bodyText = `Total: ${total} | 🟢 ON: ${active}\n\n`;
  if (total === 0) bodyText += `No gateways configured.`;
  else gateways.forEach((g, i) => { bodyText += `${i + 1}. 🌐 ${g.name}\n   ${g.isActive ? "🟢 ON" : "🔴 OFF"}\n   🔗 ${(g.url_template || g.url).substring(0, 35)}...\n\n`; });
  let kb = new InlineKeyboard().text(makeBtn("Add New Gateway"), "gw_add_new").row();
  for (let g of gateways) { let icon = g.isActive ? "🟢" : "🔴"; kb.text(`${icon} ${g.name}`, `gw_view_${g.name}`).row(); }
  kb.row({ text: makeBtn("Back"), callback_data: "adm_gateway_menu" });
  await ctx.editMessageText(`🌐 <b>Gateways</b>\n\n<blockquote>${bodyText}</blockquote>`, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("gw_add_new", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "GW_WAIT_NAME_V2";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`🏦 Add New Gateway\n\n📝 Send Gateway Name:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_gateway_list") }).catch(() => { });
});

bot.callbackQuery(/^gw_view_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let name = ctx.callbackQuery.data.replace("gw_view_", "");
  let gw = await Gateway.findOne({ name }).lean();
  if (!gw) return ctx.answerCallbackQuery({ text: "Not found", show_alert: true }).catch(() => { });
  let urlShow = gw.url_template || gw.url || "";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let bodyText = `URL:\n<code>${urlShow}</code>\n\nStatus: ${gw.isActive ? "🟢 ON" : "🔴 OFF"}\nMin: ₹${gw.minAmount || 0}\nMax: ₹${gw.maxAmount || 0}\nTax: ${gw.taxPercent || 0}%\n\nCreated: ${formatDateTime(gw.createdAt)}`;
  let kb = new InlineKeyboard()
    .text(makeBtn("Edit Settings"), `gw_edit_${gw.name}`).row()
    .text(makeBtn(gw.isActive ? "Turn OFF" : "Turn ON"), `gw_toggle_${gw.name}`).row()
    .text(makeBtn("Edit URL"), `gw_edit_url_${gw.name}`).row()
    .text(makeBtn("Delete Gateway"), `gw_del_${gw.name}`).row()
    .text(makeBtn("Back"), "adm_gateway_list");
  await ctx.editMessageText(`<b>Gateway: ${gw.name}</b>\n\n<blockquote>${bodyText}</blockquote>`, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^gw_toggle_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let name = ctx.callbackQuery.data.replace("gw_toggle_", "");
  let gw = await Gateway.findOne({ name });
  if (!gw) return;
  gw.isActive = !gw.isActive;
  gw.updatedAt = new Date();
  await gw.save();
  await ctx.answerCallbackQuery({ text: gw.isActive ? "ON" : "OFF" }).catch(() => { });
  await rerender(ctx, `gw_view_${name}`);
});

bot.callbackQuery(/^gw_edit_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let name = ctx.callbackQuery.data.replace("gw_edit_", "");
  let gw = await Gateway.findOne({ name });
  if (!gw) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let text = `<b>${name} Settings</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nStatus: ${gw.isActive ? "ON" : "OFF"}\nMin: ₹${gw.minAmount || 0}\nMax: ₹${gw.maxAmount || 0}\nTax: ${gw.taxPercent || 0}%\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  let kb = new InlineKeyboard()
    .text(makeBtn("Set Min"), `gw_min_${name}`).row()
    .text(makeBtn("Set Max"), `gw_max_${name}`).row()
    .text(makeBtn("Set Tax"), `gw_tax_${name}`).row()
    .text(makeBtn(gw.isActive ? "Turn OFF" : "Turn ON"), `gw_toggle_${name}`).row()
    .text(makeBtn("Back"), `gw_view_${name}`);
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^gw_min_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let name = ctx.callbackQuery.data.replace("gw_min_", "");
  userState[ctx.from.id] = `GW_MIN_${name}`;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`Set Min Amount\n\nSend minimum amount:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), `gw_edit_${name}`) }).catch(() => { });
});

bot.callbackQuery(/^gw_max_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let name = ctx.callbackQuery.data.replace("gw_max_", "");
  userState[ctx.from.id] = `GW_MAX_${name}`;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`Set Max Amount\n\nSend maximum amount:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), `gw_edit_${name}`) }).catch(() => { });
});

bot.callbackQuery(/^gw_tax_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let name = ctx.callbackQuery.data.replace("gw_tax_", "");
  userState[ctx.from.id] = `GW_TAX_${name}`;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`Set Tax Percent\n\nSend tax % (0-50):`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), `gw_edit_${name}`) }).catch(() => { });
});

bot.callbackQuery(/^gw_edit_url_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let name = ctx.callbackQuery.data.replace("gw_edit_url_", "");
  userState[ctx.from.id] = `GW_EDIT_URL_${name}`;
  let gw = await Gateway.findOne({ name }).lean();
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Edit Gateway URL</b>\n\n📛 ${name}\n\nCurrent:\n<code>${gw.url}</code>\n\nSend new URL template:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), `gw_view_${name}`) }).catch(() => { });
});

bot.callbackQuery(/^gw_del_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let name = ctx.callbackQuery.data.replace("gw_del_", "");
  await Gateway.deleteOne({ name });
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Gateway Deleted", name, 0, null);
  await ctx.answerCallbackQuery({ text: "Deleted!" }).catch(() => { });
  await renderGatewayMenu(ctx);
});

// ==================== AUTO UPI ADMIN ====================
bot.callbackQuery("adm_auto_upi", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderAutoUpiMenu(ctx);
});

async function renderAutoUpiMenu(ctx) {
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let gateways = await AutoUpi.find({}).sort({ createdAt: 1 }).lean();
  let total = gateways.length;
  let active = gateways.filter(g => g.status === "active").length;
  let bodyText = `Total: ${total} | 🟢 ON: ${active}\n\n`;
  if (total === 0) bodyText += `No Auto UPI gateways configured.`;
  else gateways.forEach((g, i) => {
    bodyText += `${i + 1}. 🌐 ${g.name}\n   ${g.status === "active" ? "🟢 ON" : "🔴 OFF"} | ${g.method}\n\n`;
  });
  let kb = new InlineKeyboard().text(makeBtn("➕ Add New Auto UPI"), "auto_upi_add").row();
  for (let g of gateways) {
    let icon = g.status === "active" ? "🟢" : "🔴";
    kb.text(`${icon} ${g.name}`, `auto_upi_view_${g.gatewayId}`).row();
  }
  kb.text(makeBtn("Back"), "adm_gateway_menu");
  await ctx.editMessageText(`⚡ <b>Auto UPI</b>\n\n<blockquote>${bodyText}</blockquote>`, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("auto_upi_add", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`➕ <b>Add New Auto UPI</b>\n\nChoose model:`, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .text(makeBtn("📝 Simple Model"), "auto_upi_simple").row()
      .text(makeBtn("⚙️ Advanced Model"), "auto_upi_advanced").row()
      .text(makeBtn("Back"), "adm_auto_upi")
  }).catch(() => { });
});

bot.callbackQuery("auto_upi_simple", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "AUTO_UPI_SIMPLE_NAME";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(
    `📝 <b>Simple Model</b>\n\nStep 1 of 2\n\n📝 Send Gateway Name:\n\nExample:\nCASHFREE\nPHONEPE`,
    { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_auto_upi") }
  ).catch(() => { });
});

bot.callbackQuery("auto_upi_advanced", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "AUTO_UPI_ADVANCED_INPUT";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(
    `⚙️ <b>Advanced Model</b>\n\n📝 Send in single line:\n\nFormat:\n<code>NAME::METHOD::URL</code>\n\nExamples:\n<code>CASHFREE::GET::https://api.cashfree.com/payout</code>\n<code>PHONEPE::POST::https://api.phonepe.com/payout</code>`,
    { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_auto_upi") }
  ).catch(() => { });
});

bot.callbackQuery(/^auto_upi_view_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let gwId = ctx.callbackQuery.data.replace("auto_upi_view_", "");
  let gw = await AutoUpi.findOne({ gatewayId: gwId }).lean();
  if (!gw) return ctx.answerCallbackQuery({ text: "Not found", show_alert: true }).catch(() => { });
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let statusIcon = gw.status === "active" ? "🟢 ON" : "🔴 OFF";
  let bodyText = `Status: ${statusIcon}\nMethod: ${gw.method || "GET"}\nMin: ₹${gw.minAmount || 0} | Max: ₹${gw.maxAmount || 0}\nTax: ${gw.taxPercent || 0}%\n\nURL:\n<code>${gw.apiUrl}</code>`;
  let kb = new InlineKeyboard()
    .text(makeBtn("✏️ Edit Settings"), `auto_upi_edit_${gw.gatewayId}`).row()
    .text(makeBtn(gw.status === "active" ? "🔴 Turn OFF" : "🟢 Turn ON"), `auto_upi_toggle_${gw.gatewayId}`).row()
    .text(makeBtn("🗑️ Delete"), `auto_upi_del_${gw.gatewayId}`).row()
    .text(makeBtn("Back"), "adm_auto_upi");
  await ctx.editMessageText(`🌐 <b>${gw.name}</b>\n\n<blockquote>${bodyText}</blockquote>`, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_edit_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let gwId = ctx.callbackQuery.data.replace("auto_upi_edit_", "");
  let gw = await AutoUpi.findOne({ gatewayId: gwId }).lean();
  if (!gw) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let kb = new InlineKeyboard()
    .text(makeBtn("📝 Edit Name"), `auto_upi_edit_name_${gwId}`).row()
    .text(makeBtn("🌐 Edit URL"), `auto_upi_edit_url_${gwId}`).row()
    .text(makeBtn("⚙️ Edit Method"), `auto_upi_edit_method_${gwId}`).row()
    .text(makeBtn("💰 Set Min Amount"), `auto_upi_set_min_${gwId}`).row()
    .text(makeBtn("💰 Set Max Amount"), `auto_upi_set_max_${gwId}`).row()
    .text(makeBtn("📊 Set Tax %"), `auto_upi_set_tax_${gwId}`).row()
    .text(makeBtn("Back"), `auto_upi_view_${gwId}`);
  await ctx.editMessageText(`✏️ <b>Edit ${gw.name}</b>\n\nChoose what to edit:`, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_edit_name_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let gwId = ctx.callbackQuery.data.replace("auto_upi_edit_name_", "");
  userState[ctx.from.id] = `AUTO_UPI_EDIT_NAME_${gwId}`;
  await ctx.editMessageText(`📝 Send new name:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("Cancel", `auto_upi_edit_${gwId}`) }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_edit_url_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let gwId = ctx.callbackQuery.data.replace("auto_upi_edit_url_", "");
  userState[ctx.from.id] = `AUTO_UPI_EDIT_URL_${gwId}`;
  await ctx.editMessageText(`🌐 Send new URL:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("Cancel", `auto_upi_edit_${gwId}`) }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_edit_method_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let gwId = ctx.callbackQuery.data.replace("auto_upi_edit_method_", "");
  await ctx.editMessageText(`⚙️ Choose method:`, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .text("GET", `auto_upi_set_method_${gwId}_GET`).row()
      .text("POST", `auto_upi_set_method_${gwId}_POST`).row()
      .text("Cancel", `auto_upi_edit_${gwId}`)
  }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_set_method_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let data = ctx.callbackQuery.data.replace("auto_upi_set_method_", "");
  let parts = data.split("_");
  let method = parts.pop();
  let gwId = parts.join("_");
  await AutoUpi.updateOne({ gatewayId: gwId }, { method });
  await ctx.editMessageText(`✅ Method set to ${method}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("Back", `auto_upi_view_${gwId}`) }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_set_min_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let gwId = ctx.callbackQuery.data.replace("auto_upi_set_min_", "");
  userState[ctx.from.id] = `AUTO_UPI_MIN_${gwId}`;
  await ctx.editMessageText(`💰 Send minimum amount:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("Cancel", `auto_upi_edit_${gwId}`) }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_set_max_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let gwId = ctx.callbackQuery.data.replace("auto_upi_set_max_", "");
  userState[ctx.from.id] = `AUTO_UPI_MAX_${gwId}`;
  await ctx.editMessageText(`💰 Send maximum amount:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("Cancel", `auto_upi_edit_${gwId}`) }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_set_tax_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let gwId = ctx.callbackQuery.data.replace("auto_upi_set_tax_", "");
  userState[ctx.from.id] = `AUTO_UPI_TAX_${gwId}`;
  await ctx.editMessageText(`📊 Send tax % (0-50):`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("Cancel", `auto_upi_edit_${gwId}`) }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_toggle_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let gwId = ctx.callbackQuery.data.replace("auto_upi_toggle_", "");
  let gw = await AutoUpi.findOne({ gatewayId: gwId });
  if (!gw) return;
  gw.status = gw.status === "active" ? "off" : "active";
  await gw.save();
  await ctx.answerCallbackQuery({ text: gw.status === "active" ? "🟢 ON" : "🔴 OFF" }).catch(() => { });
  await rerender(ctx, `auto_upi_view_${gwId}`);
});

bot.callbackQuery(/^auto_upi_del_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let gwId = ctx.callbackQuery.data.replace("auto_upi_del_", "");
  await AutoUpi.deleteOne({ gatewayId: gwId });
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Auto UPI Deleted", gwId, 0, null);
  await ctx.answerCallbackQuery({ text: "🗑️ Deleted!" }).catch(() => { });
  await renderAutoUpiMenu(ctx);
});

// ==================== QUICK PAY SETTINGS ====================
bot.callbackQuery("adm_quick_pay", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderQuickPaySettings(ctx);
});

async function renderQuickPaySettings(ctx) {
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let enabled = await getConfig("quick_pay_enabled", true);
  let unlimited = await getConfig("quick_pay_unlimited", true);
  let negative = await getConfig("quick_pay_negative_balance", false);
  let taxPercent = await getConfig("quick_pay_tax_percent", 0);
  let whitelist = await getConfig("quick_pay_whitelist", []);
  let wlCount = Array.isArray(whitelist) ? whitelist.length : 0;

  let text = `⚡ <b>Quick Pay Settings</b>\n\n` +
    `📊 Global: ${enabled ? "🟢 ON" : "🔴 OFF"}\n` +
    `♾️ Unlimited: ${unlimited ? "🟢 ON" : "🔴 OFF"}\n` +
    `📉 Negative Balance: ${negative ? "🟢 ON" : "🔴 OFF"}\n` +
    `📊 Tax: ${taxPercent}%\n` +
    `👥 Whitelist: ${wlCount} users\n\n` +
    `👇 Choose:`;

  let kb = new InlineKeyboard()
    .text(makeBtn(`📊 Global: ${enabled ? "ON" : "OFF"}`), "qp_toggle_global").row()
    .text(makeBtn(`♾️ Unlimited: ${unlimited ? "ON" : "OFF"}`), "qp_toggle_unlimited").row()
    .text(makeBtn(`📉 Negative: ${negative ? "ON" : "OFF"}`), "qp_toggle_negative").row()
    .text(makeBtn("👥 Whitelist Users"), "qp_whitelist").row()
    .text(makeBtn("📊 Set Tax %"), "qp_set_tax").row()
    .text(makeBtn("Back"), "admin");

  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("qp_toggle_global", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let cur = await getConfig("quick_pay_enabled", true);
  await setConfig("quick_pay_enabled", !cur);
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Quick Pay Global Toggle", !cur ? "ON" : "OFF", 0, null);
  await ctx.answerCallbackQuery({ text: !cur ? "🟢 ON" : "🔴 OFF" }).catch(() => { });
  await renderQuickPaySettings(ctx);
});

bot.callbackQuery("qp_toggle_unlimited", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let cur = await getConfig("quick_pay_unlimited", true);
  await setConfig("quick_pay_unlimited", !cur);
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Quick Pay Unlimited Toggle", !cur ? "ON" : "OFF", 0, null);
  await ctx.answerCallbackQuery({ text: !cur ? "🟢 ON" : "🔴 OFF" }).catch(() => { });
  await renderQuickPaySettings(ctx);
});

bot.callbackQuery("qp_toggle_negative", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let cur = await getConfig("quick_pay_negative_balance", false);
  await setConfig("quick_pay_negative_balance", !cur);
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Quick Pay Negative Toggle", !cur ? "ON" : "OFF", 0, null);
  await ctx.answerCallbackQuery({ text: !cur ? "🟢 ON" : "🔴 OFF" }).catch(() => { });
  await renderQuickPaySettings(ctx);
});

bot.callbackQuery("qp_whitelist", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderQuickPayWhitelist(ctx);
});

async function renderQuickPayWhitelist(ctx) {
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let whitelist = await getConfig("quick_pay_whitelist", []);
  if (!Array.isArray(whitelist)) whitelist = [];

  let bodyText = `Total: ${whitelist.length}\n\n`;
  if (whitelist.length === 0) bodyText += `No whitelisted users.`;
  else {
    for (let i = 0; i < whitelist.length; i++) {
      let uid = whitelist[i];
      let u = await User.findOne({ userId: uid }).lean();
      bodyText += `${i + 1}. ${u?.firstName || "User"} (${uid})\n`;
    }
  }

  let kb = new InlineKeyboard()
    .text(makeBtn("➕ Add User ID"), "qp_whitelist_add").row()
    .text(makeBtn("➖ Remove User ID"), "qp_whitelist_remove").row()
    .text(makeBtn("Back"), "adm_quick_pay");

  await ctx.editMessageText(`👥 <b>Whitelist Users</b>\n\n<blockquote>${bodyText}</blockquote>`, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("qp_whitelist_add", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "QP_WHITELIST_ADD";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`➕ <b>Add to Whitelist</b>\n\n📝 Send User ID:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "qp_whitelist") }).catch(() => { });
});

bot.callbackQuery("qp_whitelist_remove", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "QP_WHITELIST_REMOVE";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`➖ <b>Remove from Whitelist</b>\n\n📝 Send User ID:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "qp_whitelist") }).catch(() => { });
});

bot.callbackQuery("qp_set_tax", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "QP_SET_TAX";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let cur = await getConfig("quick_pay_tax_percent", 0);
  await ctx.editMessageText(`📊 <b>Set Quick Pay Tax</b>\n\nCurrent: ${cur}%\n\n📝 Send new tax % (0-50):`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_quick_pay") }).catch(() => { });
});

// ==================== MANAGE WITHDRAW ====================
bot.callbackQuery("adm_manage_withdraw", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderManageWithdraw(ctx);
});

async function renderManageWithdraw(ctx) {
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  const methods = ["upi", "bank", "amazon", "redeem"];
  for (let m of methods) {
    let s = await WithdrawSettings.findOne({ method: m });
    if (!s) await WithdrawSettings.create({ method: m, isActive: false, minAmount: 0, maxAmount: 0, taxPercent: 0 });
  }
  let settings = await WithdrawSettings.find({}).lean();
  let gateways = await Gateway.find({}).sort({ createdAt: 1 }).lean();
  let autoUpis = await AutoUpi.find({}).sort({ createdAt: 1 }).lean();

  let text = `<b>Manage Withdraw</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  text += `<b>Manual Withdraw</b>\n\n`;
  for (let m of methods) {
    let s = settings.find(x => x.method === m);
    if (!s) continue;
    text += `${m.toUpperCase()} (₹${s.minAmount} - ₹${s.maxAmount}) ${s.isActive ? "🟢" : "🔴"}\n`;
  }
  if (gateways.length > 0) {
    text += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<b>Auto Gateway</b>\n\n`;
    for (let g of gateways) text += `${g.name} (₹${g.minAmount || 0} - ₹${g.maxAmount || 0}) ${g.isActive ? "🟢" : "🔴"}\n`;
  }
  if (autoUpis.length > 0) {
    text += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<b>Auto UPI</b>\n\n`;
    for (let a of autoUpis) text += `${a.name} (₹${a.minAmount || 0} - ₹${a.maxAmount || 0}) ${a.status === "active" ? "🟢" : "🔴"}\n`;
  }
  text += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nClick to edit:`;

  let kb = new InlineKeyboard();
  for (let m of methods) kb.text(makeBtn(m.toUpperCase()), `admwd_edit_${m}`).row();
  for (let g of gateways) kb.text(makeBtn(g.name.toUpperCase()), `gw_edit_${g.name}`).row();
  for (let a of autoUpis) kb.text(makeBtn(`⚡ ${a.name}`), `auto_upi_edit_${a.gatewayId}`).row();
  kb.text(makeBtn("Back"), "adm_customize_theme");

  if (ctx.callbackQuery) await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
  else await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery(/^admwd_edit_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let method = ctx.callbackQuery.data.replace("admwd_edit_", "");
  let s = await WithdrawSettings.findOne({ method });
  if (!s) s = await WithdrawSettings.create({ method, isActive: false, minAmount: 0, maxAmount: 0, taxPercent: 0 });
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let text = `<b>${method.toUpperCase()} Settings</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nStatus: ${s.isActive ? "🟢 ON" : "🔴 OFF"}\nMin: ₹${s.minAmount}\nMax: ₹${s.maxAmount}\nTax: ${s.taxPercent}%\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  let kb = new InlineKeyboard()
    .text(makeBtn("Set Min"), `admwd_min_${method}`).row()
    .text(makeBtn("Set Max"), `admwd_max_${method}`).row()
    .text(makeBtn("Set Tax"), `admwd_tax_${method}`).row()
    .text(makeBtn(s.isActive ? "Turn OFF" : "Turn ON"), `admwd_toggle_${method}`).row()
    .text(makeBtn("Back"), "adm_manage_withdraw");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^admwd_toggle_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let method = ctx.callbackQuery.data.replace("admwd_toggle_", "");
  let s = await WithdrawSettings.findOne({ method });
  if (!s) s = await WithdrawSettings.create({ method, isActive: false });
  else { s.isActive = !s.isActive; s.updatedAt = new Date(); await s.save(); }
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Method Toggled", `${method} → ${s.isActive ? "ON" : "OFF"}`, 0, null);
  await ctx.answerCallbackQuery({ text: s.isActive ? "ON" : "OFF" }).catch(() => { });
  await rerender(ctx, `admwd_edit_${method}`);
});

bot.callbackQuery(/^admwd_min_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let method = ctx.callbackQuery.data.replace("admwd_min_", "");
  userState[ctx.from.id] = `ADMWD_MIN_${method}`;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`Set Min Amount\n\nSend minimum amount:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), `admwd_edit_${method}`) }).catch(() => { });
});

bot.callbackQuery(/^admwd_max_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let method = ctx.callbackQuery.data.replace("admwd_max_", "");
  userState[ctx.from.id] = `ADMWD_MAX_${method}`;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`Set Max Amount\n\nSend maximum amount:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), `admwd_edit_${method}`) }).catch(() => { });
});

bot.callbackQuery(/^admwd_tax_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let method = ctx.callbackQuery.data.replace("admwd_tax_", "");
  userState[ctx.from.id] = `ADMWD_TAX_${method}`;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`Set Tax Percent\n\nSend tax % (0-50):`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), `admwd_edit_${method}`) }).catch(() => { });
});

// ==================== TASKS ====================
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

bot.callbackQuery("adm_task_alert_channel", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "WAITING_TASK_ALERT_CHANNEL";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let current = await getConfig("default_task_alert_channel", "Not Set");
  await ctx.editMessageText(`➕ <b>Add Channel For Task Alert</b>\n\n📌 Current: <code>${current}</code>\n\n📝 Send Channel Username:\n\nExample:\n<code>@yourchannel</code>\n<code>-1001234567890</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_tasks_manager") }).catch(() => { });
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

bot.callbackQuery(/^del_task_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let tId = ctx.callbackQuery.data.replace("del_task_", "");
  let task = await Task.findOne({ taskId: tId }).lean();
  if (!task) { await ctx.answerCallbackQuery({ text: "Already deleted", show_alert: true }).catch(() => { }); return renderTaskManager(ctx); }
  await Task.deleteOne({ taskId: tId });
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Task Deleted", `${task.title} (${task.taskId})`, 0, null);
  await ctx.answerCallbackQuery({ text: "🗑️ Task Deleted!" }).catch(() => { });
  await renderTaskManager(ctx);
});

bot.callbackQuery(/^toggle_task_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let taskId = ctx.callbackQuery.data.replace("toggle_task_", "");
  let task = await Task.findOne({ taskId });
  if (!task) return ctx.answerCallbackQuery({ text: "Not found", show_alert: true }).catch(() => { });
  task.isActive = task.isActive === false ? true : false;
  await task.save();
  await ctx.answerCallbackQuery({ text: task.isActive ? "Activated" : "Deactivated" }).catch(() => { });
  await renderTaskManager(ctx);
});

bot.callbackQuery(/^task_edit_title_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let tId = ctx.callbackQuery.data.replace("task_edit_title_", "");
  userState[ctx.from.id] = `TASK_EDIT_TITLE_${tId}`;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`📝 Send new title:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), `view_task_${tId}`) }).catch(() => { });
});

bot.callbackQuery(/^task_edit_reward_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let tId = ctx.callbackQuery.data.replace("task_edit_reward_", "");
  userState[ctx.from.id] = `TASK_EDIT_REWARD_${tId}`;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`📝 Send new reward:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), `view_task_${tId}`) }).catch(() => { });
});

bot.callbackQuery(/^task_edit_link_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let tId = ctx.callbackQuery.data.replace("task_edit_link_", "");
  userState[ctx.from.id] = `TASK_EDIT_LINK_${tId}`;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`📝 Send new link:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), `view_task_${tId}`) }).catch(() => { });
});

bot.callbackQuery(/^task_edit_channel_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let tId = ctx.callbackQuery.data.replace("task_edit_channel_", "");
  userState[ctx.from.id] = `TASK_EDIT_CHANNEL_${tId}`;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`📝 Send new alert channel:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), `view_task_${tId}`) }).catch(() => { });
});

bot.callbackQuery(/^task_edit_type_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let tId = ctx.callbackQuery.data.replace("task_edit_type_", "");
  let task = await Task.findOne({ taskId: tId });
  if (!task) return;
  let newType = (task.taskType || "photo") === "photo" ? "refer" : "photo";
  await Task.updateOne({ taskId: tId }, { taskType: newType });
  await ctx.answerCallbackQuery({ text: `${newType.toUpperCase()}` }).catch(() => { });
  await rerender(ctx, `view_task_${tId}`);
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

bot.callbackQuery("task_field_name", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "TASK_FIELD_NAME";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`${toSmallCaps("Enter Task Name")}\n\nSend the task name:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "task_create_start") }).catch(() => { });
});

bot.callbackQuery("task_field_reward", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "TASK_FIELD_REWARD";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`${toSmallCaps("Enter Reward")}\n\nSend amount in INR:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "task_create_start") }).catch(() => { });
});

bot.callbackQuery("task_field_link", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "TASK_FIELD_LINK";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`${toSmallCaps("Enter Task Link")}\n\nSend the link:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "task_create_start") }).catch(() => { });
});

bot.callbackQuery("task_field_desc", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "TASK_FIELD_DESC";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`${toSmallCaps("Enter Description")}\n\nSend description (optional):`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "task_create_start") }).catch(() => { });
});

bot.callbackQuery("task_field_timelimit", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let kb = new InlineKeyboard()
    .text(makeBtn("5 Minutes"), "task_tl_5").row()
    .text(makeBtn("10 Minutes"), "task_tl_10").row()
    .text(makeBtn("30 Minutes"), "task_tl_30").row()
    .text(makeBtn("1 Hour"), "task_tl_60").row()
    .text(makeBtn("1 Day"), "task_tl_1440").row()
    .text(makeBtn("Custom Time"), "task_tl_custom").row()
    .text(makeBtn("Back"), "task_create_start");
  await ctx.editMessageText(`<b>Time Limit</b>\n\nSelect task expiry time:`, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^task_tl_(\d+)$/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let minutes = parseInt(ctx.callbackQuery.data.replace("task_tl_", ""), 10);
  let temp = global.taskCreation?.[ctx.from.id];
  if (!temp) return ctx.answerCallbackQuery({ text: "Session expired", show_alert: true }).catch(() => { });
  temp.expiryMinutes = minutes;
  let display = formatMinutes(minutes);
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`${toSmallCaps("Successfully Added")}\n\nTime Limit: ${display}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "task_create_start") }).catch(() => { });
});

bot.callbackQuery("task_tl_custom", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "TASK_FIELD_CUSTOM_TIME";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`Custom Time Limit\n\nSend time in minutes:\n\nExamples:\n• 5    (5 minutes)\n• 60   (1 hour)\n• 1440 (1 day)`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "task_field_timelimit") }).catch(() => { });
});

bot.callbackQuery("task_field_submit", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let temp = global.taskCreation?.[ctx.from.id];
  if (!temp) return ctx.answerCallbackQuery({ text: "Session expired", show_alert: true }).catch(() => { });
  let missing = [];
  if (!temp.title) missing.push("Task Name");
  if (!temp.reward) missing.push("Reward");
  if (!temp.link) missing.push("Link");
  if (missing.length > 0) return ctx.answerCallbackQuery({ text: `Missing: ${missing.join(", ")}`, show_alert: true }).catch(() => { });
  let alertChannel = await getConfig("default_task_alert_channel", "Not Set");
  let expiresAt = null;
  if (temp.expiryMinutes && temp.expiryMinutes > 0) expiresAt = new Date(Date.now() + temp.expiryMinutes * 60 * 1000);
  try {
    await Task.create({ taskId: temp.taskId, title: temp.title, reward: temp.reward, link: temp.link, description: temp.description || "", taskType: "photo", alertChannel: alertChannel, isActive: true, isComplete: true, completedUsers: [], expiryMinutes: temp.expiryMinutes || 0, expiresAt: expiresAt });
    await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Task Created", temp.title, temp.reward);
    delete global.taskCreation[ctx.from.id];
    let bodyText = `Task ID: <code>${temp.taskId}</code>\nName: ${temp.title}\nReward: ₹${temp.reward}\nLink: ${temp.link}\n`;
    if (temp.description) bodyText += `Description: ${temp.description}\n`;
    if (temp.expiryMinutes) bodyText += `Time Limit: ${formatMinutes(temp.expiryMinutes)}\n`;
    else bodyText += `Time Limit: None\n`;
    bodyText += `Alert Channel: ${alertChannel}`;
    const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
    const makeBtn = (text) => `${pad}${text}${pad}`;
    await ctx.editMessageText(`<b>Task Created Successfully</b>\n\n<blockquote>${bodyText}</blockquote>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back to Manage Tasks"), "adm_tasks_manager") }).catch(() => { });
  } catch (e) { await ctx.reply(`Error: ${e.message}`).catch(() => { }); }
});

bot.callbackQuery("adm_search_task", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "TASK_SEARCH";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Search Task</b>\n\nSend Task ID or Task Name:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_tasks_manager") }).catch(() => { });
});

// ==================== STATUS ====================
bot.callbackQuery("adm_status", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let pendingCount = await Withdrawal.countDocuments({ status: "Pending" });
  let text = `<b>Status</b>\n\n👇 Choose option:`;
  let kb = new InlineKeyboard()
    .text(makeBtn("Live Balance Tracker"), "status_live_tracker").row()
    .text(makeBtn("Users List"), "status_users_list").row()
    .text(makeBtn("Live Fund"), "status_live_fund").row()
    .text(makeBtn("New Users"), "adm_new_users").row()
    .text(makeBtn(`Withdraw Requests (${pendingCount})`), "status_wd_requests").row()
    .text(makeBtn("Withdraw Stats"), "status_wd_stats").row()
    .text(makeBtn("Back to Admin"), "admin");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("status_live_tracker", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderLiveBalanceTracker(ctx, 0);
});

async function renderLiveBalanceTracker(ctx, page = 0) {
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let perPage = 10;
  let totalUsers = await User.countDocuments({});
  let totalPages = Math.ceil(totalUsers / perPage);
  if (page < 0) page = 0;
  if (page >= totalPages) page = Math.max(0, totalPages - 1);
  let users = await User.find({}).sort({ balance: -1, createdAt: -1 }).skip(page * perPage).limit(perPage).lean();
  let totalBalanceArr = await User.aggregate([{ $group: { _id: null, total: { $sum: "$balance" } } }]);
  let totalBalance = totalBalanceArr[0]?.total || 0;
  let text = `<b>Live Balance Tracker</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nTotal Users: ${totalUsers}\nTotal Balance: ₹${totalBalance.toFixed(2)}\nPage: ${page + 1}/${totalPages || 1}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<b>By Balance High to Low:</b>\n\n`;
  users.forEach((u, i) => { text += `${page * perPage + i + 1}. ${u.firstName || "User"}\n   ID: <code>${u.userId}</code>\n   Balance: ${formatBalance(u.balance)}\n\n`; });
  text += `👇 Tap to open profile:`;
  let kb = new InlineKeyboard();
  for (let u of users) {
    let name = (u.firstName || "User").substring(0, 15);
    let amount = formatBalance(u.balance);
    let label = `${name} · ${amount}`;
    kb.url(label, `tg://user?id=${u.userId}`).row();
  }
  let navRow = [];
  if (page > 0) navRow.push({ text: "◀️", callback_data: `status_lb_page_${page - 1}` });
  navRow.push({ text: "🔄", callback_data: `status_lb_page_${page}` });
  if (page < totalPages - 1) navRow.push({ text: "▶️", callback_data: `status_lb_page_${page + 1}` });
  kb.row(...navRow);
  kb.row({ text: makeBtn("Back"), callback_data: "adm_status" });
  if (ctx.callbackQuery) await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
  else await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery(/^status_lb_page_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let page = parseInt(ctx.callbackQuery.data.replace("status_lb_page_", ""), 10);
  await renderLiveBalanceTracker(ctx, page);
});

bot.callbackQuery("status_users_list", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderUsersList(ctx, 0);
});

async function renderUsersList(ctx, page = 0) {
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let perPage = 10;
  let totalUsers = await User.countDocuments({});
  let totalPages = Math.ceil(totalUsers / perPage);
  if (page < 0) page = 0;
  if (page >= totalPages) page = Math.max(0, totalPages - 1);
  let users = await User.find({}).sort({ createdAt: -1 }).skip(page * perPage).limit(perPage).lean();
  let activeCount = await User.countDocuments({ isBanned: false });
  let bannedCount = await User.countDocuments({ isBanned: true });
  let bodyText = `Total: ${totalUsers}\n✅ Active: ${activeCount}\n🚫 Banned: ${bannedCount}\n📄 Page: ${page + 1}/${totalPages || 1}`;
  let text = `<b>Users List</b>\n\n<blockquote>${bodyText}</blockquote>`;
  let kb = new InlineKeyboard();
  for (let u of users) {
    let name = (u.firstName || "User").substring(0, 12);
    let status = u.isBanned ? "🚫" : "✅";
    kb.text(`${status} ${name}`, `userslist_view_${u.userId}`).row();
  }
  let navRow = [];
  if (page > 0) navRow.push({ text: "◀️", callback_data: `status_ul_page_${page - 1}` });
  navRow.push({ text: "🔄", callback_data: `status_ul_page_${page}` });
  if (page < totalPages - 1) navRow.push({ text: "▶️", callback_data: `status_ul_page_${page + 1}` });
  kb.row(...navRow);
  kb.row({ text: makeBtn("Back"), callback_data: "adm_status" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery(/^status_ul_page_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let page = parseInt(ctx.callbackQuery.data.replace("status_ul_page_", ""), 10);
  await renderUsersList(ctx, page);
});

bot.callbackQuery(/^userslist_view_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let uid = parseInt(ctx.callbackQuery.data.replace("userslist_view_", ""), 10);
  let user = await User.findOne({ userId: uid }).lean();
  if (!user) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let bodyText = `Name: ${user.firstName || "User"}\nID: ${uid}\nBalance: ${formatBalance(user.balance)}\nWithdrawn: ₹${(user.withdrawnTotal || 0).toFixed(2)}\nStatus: ${user.isBanned ? "🚫 Banned" : "✅ Active"}\nJoined: ${formatDateTime(user.createdAt)}`;
  let text = `<b>User Details</b>\n\n<blockquote>${bodyText}</blockquote>`;
  let kb = new InlineKeyboard().text(makeBtn("Back"), "status_users_list").text(makeBtn("Admin Panel"), "admin");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("status_live_fund", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let fund = await LiveFund.findOne({ key: "main_fund" }).lean();
  if (!fund) fund = await LiveFund.create({ key: "main_fund" });
  let totalUsers = await User.countDocuments({});
  let totalBalanceArr = await User.aggregate([{ $group: { _id: null, total: { $sum: "$balance" } } }]);
  let totalBalance = totalBalanceArr[0]?.total || 0;
  let totalWdArr = await Withdrawal.aggregate([{ $match: { status: "Approved" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]);
  let totalWd = totalWdArr[0]?.total || 0;
  let running = (fund.totalFund || 0) - (fund.usedFund || 0);
  let usedPercent = fund.totalFund > 0 ? ((fund.usedFund / fund.totalFund) * 100).toFixed(1) : 0;
  let bodyText = `🏦 Bot Total Fund: ₹${totalBalance.toFixed(2)}\n📤 Total Paid Out: ₹${totalWd.toFixed(2)}\n👥 Total Users: ${totalUsers}\n\n⚙️ Running Fund System\n📊 Status: ${fund.isActive ? "🟢 ON" : "🔴 OFF"}\n💰 Set Fund: ₹${(fund.totalFund || 0).toFixed(2)}\n📉 Running: ₹${running.toFixed(2)}\n📤 Used: ₹${(fund.usedFund || 0).toFixed(2)} (${usedPercent}%)`;
  let kb = new InlineKeyboard()
    .text(makeBtn("Set Fund"), "livefund_set").row()
    .text(makeBtn(fund.isActive ? "Turn OFF" : "Turn ON"), "livefund_toggle").row()
    .text(makeBtn("Reset Fund"), "livefund_reset").row()
    .text(makeBtn("View Payouts"), "livefund_payouts").row()
    .text(makeBtn("Back"), "adm_status");
  await ctx.editMessageText(`<b>Live Fund</b>\n\n<blockquote>${bodyText}</blockquote>`, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("livefund_set", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "LIVEFUND_WAIT_AMOUNT";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Set Live Fund</b>\n\n📝 Send amount:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "status_live_fund") }).catch(() => { });
});

bot.callbackQuery("livefund_toggle", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let fund = await LiveFund.findOne({ key: "main_fund" });
  if (!fund) fund = await LiveFund.create({ key: "main_fund" });
  fund.isActive = !fund.isActive;
  fund.updatedAt = new Date();
  await fund.save();
  await ctx.answerCallbackQuery({ text: fund.isActive ? "ON" : "OFF" }).catch(() => { });
  await rerender(ctx, "status_live_fund");
});

bot.callbackQuery("livefund_reset", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  await LiveFund.findOneAndUpdate({ key: "main_fund" }, { totalFund: 0, usedFund: 0, updatedAt: new Date() }, { upsert: true });
  await ctx.answerCallbackQuery({ text: "Reset!" }).catch(() => { });
  await rerender(ctx, "status_live_fund");
});

bot.callbackQuery("livefund_payouts", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let recent = await Withdrawal.find({ status: "Approved" }).sort({ approvedAt: -1 }).limit(10).lean();
  let bodyText = "";
  if (recent.length === 0) bodyText = `No payouts yet.`;
  else for (let w of recent) {
    let u = await User.findOne({ userId: w.userId }).lean();
    bodyText += `${u?.firstName || "User"} — ₹${w.amount.toFixed(2)}\n<code>${w.userId}</code> | ${formatDateTime(w.approvedAt || w.createdAt)}\n\n`;
  }
  await ctx.editMessageText(`<b>Recent Payouts</b>\n\n<blockquote>${bodyText}</blockquote>`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "status_live_fund"), parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_new_users", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderNewUsers(ctx, 0);
});

async function renderNewUsers(ctx, page = 0) {
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let perPage = 10;
  let totalUsers = await User.countDocuments({});
  let totalPages = Math.ceil(totalUsers / perPage);
  if (page < 0) page = 0;
  if (page >= totalPages) page = Math.max(0, totalPages - 1);
  let users = await User.find({}).sort({ createdAt: -1 }).skip(page * perPage).limit(perPage).lean();
  let today = new Date(); today.setHours(0, 0, 0, 0);
  let weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  let todayCount = await User.countDocuments({ createdAt: { $gte: today } });
  let weekCount = await User.countDocuments({ createdAt: { $gte: weekAgo } });
  let bodyText = `📊 Total Users: ${totalUsers}\n📅 Today: ${todayCount}\n📅 This Week: ${weekCount}\n📄 Page: ${page + 1}/${totalPages || 1}`;
  let text = `<b>New Users</b>\n\n<blockquote>${bodyText}</blockquote>`;
  let kb = new InlineKeyboard();
  for (let u of users) {
    let name = (u.firstName || "User").substring(0, 15);
    kb.text(`${name} — ${u.userId}`, `newuser_detail_${u.userId}`).row();
  }
  let navRow = [];
  if (page > 0) navRow.push({ text: "◀️", callback_data: `newusers_page_${page - 1}` });
  navRow.push({ text: "🔄", callback_data: `newusers_page_${page}` });
  if (page < totalPages - 1) navRow.push({ text: "▶️", callback_data: `newusers_page_${page + 1}` });
  kb.row(...navRow);
  kb.row({ text: makeBtn("Back"), callback_data: "adm_status" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery(/^newusers_page_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let page = parseInt(ctx.callbackQuery.data.replace("newusers_page_", ""), 10);
  await renderNewUsers(ctx, page);
});

bot.callbackQuery(/^newuser_detail_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let uid = parseInt(ctx.callbackQuery.data.replace("newuser_detail_", ""), 10);
  let u = await User.findOne({ userId: uid }).lean();
  if (!u) return ctx.answerCallbackQuery({ text: "User not found", show_alert: true }).catch(() => { });
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let bodyText = `Name: ${u.firstName || "Unknown"}\nUser ID: ${u.userId}\nUsername: ${u.username ? "@" + u.username : "No username"}\n\n🕐 Started Bot:\n${formatDateTime(u.createdAt)}`;
  let kb = new InlineKeyboard().text(makeBtn("Back"), "adm_new_users").text(makeBtn("Admin Panel"), "admin");
  await ctx.editMessageText(`<b>User Details</b>\n\n<blockquote>${bodyText}</blockquote>`, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("status_wd_requests", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let withdrawals = await Withdrawal.find({ status: "Pending" }).sort({ createdAt: -1 }).limit(30).lean();
  if (withdrawals.length === 0) return ctx.editMessageText(`<b>Withdraw Requests</b>\n\n<blockquote>No pending requests</blockquote>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_status") }).catch(() => { });
  let bodyText = `Pending: ${withdrawals.length}\n\nClick to approve:`;
  let text = `<b>Withdraw Requests</b>\n\n<blockquote>${bodyText}</blockquote>`;
  let kb = new InlineKeyboard();
  for (let w of withdrawals) {
    let u = await User.findOne({ userId: w.userId }).lean();
    let name = u?.firstName || "User";
    let label = `${name} — ₹${w.amount} (${w.method})`;
    if (label.length > 30) label = label.substring(0, 30) + "..";
    kb.text(makeBtn(label), `status_wd_view_${w.withdrawalId}`).row();
  }
  kb.text(makeBtn("Back"), "adm_status");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^status_wd_view_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let wdId = ctx.callbackQuery.data.replace("status_wd_view_", "");
  let wd = await Withdrawal.findOne({ withdrawalId: wdId }).lean();
  if (!wd) return ctx.answerCallbackQuery({ text: "Not found", show_alert: true }).catch(() => { });
  let userLink = `<a href="tg://user?id=${wd.userId}"><b>${wd.userId}</b></a>`;
  let maskedDetails = halfMaskDetails(wd.method, wd.details);
  let methodDisplay = wd.method.toUpperCase();
  let methodIcon = wd.method.toLowerCase() === "upi" ? "⚡" : wd.method.toLowerCase() === "bank" ? "🏦" : "🎁";
  let taxAmount = wd.taxAmount || 0;
  let netAmount = wd.netAmount || (wd.amount - taxAmount);
  let text =
    `⚠️ <b>New ${methodDisplay} Payout Request!</b> <code>(#${wd.userWithdrawalCount})</code>\n\n` +
    `User : ${userLink}\n` +
    `Request Amount : ₹<code>${wd.amount}</code>\n` +
    `Amount After Tax : ₹<code>${netAmount.toFixed(2)}</code>\n` +
    `${methodIcon} <b>${methodDisplay} ID :</b> <code>${maskedDetails}</code>\n\n` +
    `📊 <b>Status:</b> ⏳ Pending`;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let kb = new InlineKeyboard()
    .text(makeBtn("Approve ✅"), `wd_app_${wd.withdrawalId}`).row()
    .text(makeBtn("Reject ❌"), `wd_rej_${wd.withdrawalId}`).row()
    .text(makeBtn("💰 Fund Verify"), `fund_verify_${wd.userId}`).row()
    .text(makeBtn("🔍 Track Status"), `track_status_${wd.withdrawalId}`).row()
    .text(makeBtn("Back"), "status_wd_requests");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("status_wd_stats", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let total = await Withdrawal.countDocuments({});
  let approved = await Withdrawal.countDocuments({ status: "Approved" });
  let pending = await Withdrawal.countDocuments({ status: "Pending" });
  let rejected = await Withdrawal.countDocuments({ status: "Rejected" });
  let totalPayoutArr = await Withdrawal.aggregate([{ $match: { status: "Approved" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]);
  let totalPayout = totalPayoutArr[0]?.total || 0;
  let bodyText = `Total Requests: ${total}\nApproved: ${approved}\nPending: ${pending}\nRejected: ${rejected}\n\nTotal Payout: ₹${totalPayout.toFixed(2)}\n\nBy Method:\n`;
  for (let m of ["UPI", "BANK", "AMAZON", "REDEEM"]) {
    let count = await Withdrawal.countDocuments({ method: m, status: "Approved" });
    if (count > 0) {
      let amtArr = await Withdrawal.aggregate([{ $match: { method: m, status: "Approved" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]);
      bodyText += `${m}: ${count} — ₹${(amtArr[0]?.total || 0).toFixed(2)}\n`;
    }
  }
  await ctx.editMessageText(`<b>Withdraw Stats</b>\n\n<blockquote>${bodyText}</blockquote>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_status") }).catch(() => { });
});

bot.callbackQuery("adm_recent_actions", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let logs = await AdminLog.find({}).sort({ createdAt: -1 }).limit(15).lean();
  let bodyText = "";
  if (logs.length === 0) bodyText = `No actions yet.`;
  else logs.forEach((log, i) => { bodyText += `${i + 1}. ${log.adminName}\n   ${log.action}${log.details ? `: ${log.details}` : ''}\n   ${formatDateTime(log.createdAt)}\n\n`; });
  let kb = new InlineKeyboard().text(makeBtn("Refresh"), "adm_recent_actions").row().text(makeBtn("Back"), "admin");
  await ctx.editMessageText(`<b>Recent Admin Actions</b>\n\n<blockquote>${bodyText}</blockquote>`, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_user_notif", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let enabled = await getConfig("new_user_notif", true);
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let kb = new InlineKeyboard().text(makeBtn(enabled ? "Turn OFF" : "Turn ON"), "adm_toggle_notif").row().text(makeBtn("Back"), "admin");
  await ctx.editMessageText(`<b>New User Notification</b>\n\n📊 Status: ${enabled ? "🟢 ON" : "🔴 OFF"}`, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_toggle_notif", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let cur = await getConfig("new_user_notif", true);
  await setConfig("new_user_notif", !cur);
  await ctx.answerCallbackQuery({ text: !cur ? "ON" : "OFF" }).catch(() => { });
  await rerender(ctx, "adm_user_notif");
});

// ==================== GIFT CODES ====================
bot.callbackQuery("adm_create_gift", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderGiftCodePanel(ctx);
});

async function renderGiftCodePanel(ctx) {
  const pad = "\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let codes = await GiftCode.find({ type: "redeem" }).sort({ createdAt: -1 }).limit(20).lean();
  let totalCodes = await GiftCode.countDocuments({ type: "redeem" });
  let text = `<b>Gift Codes</b>\n\nTotal: ${totalCodes}\n\n👇 Click code to edit:`;
  let kb = new InlineKeyboard();
  for (let c of codes) {
    let shortCode = c.code.length > 15 ? c.code.substring(0, 15) + "..." : c.code;
    let status = c.usedUsers.length >= c.maxUses ? "❌" : "✅";
    kb.text(`${status} ${shortCode} — ₹${c.amount}`, `gc_view_${c.code}`).row();
  }
  kb.text(makeBtn("Add Codes"), "adm_redeem_add").row().text(makeBtn("Back"), "admin");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery(/^gc_view_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let code = ctx.callbackQuery.data.replace("gc_view_", "");
  let gc = await GiftCode.findOne({ code, type: "redeem" }).lean();
  if (!gc) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let text = `<b>Code:</b> <code>${gc.code}</code>\n\n💰 Amount: ₹${gc.amount}\n📊 Claimed: ${gc.usedUsers.length}/${gc.maxUses}`;
  let kb = new InlineKeyboard().text(makeBtn("Delete"), `gc_del_${gc.code}`).row().text(makeBtn("Back"), "adm_create_gift");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^gc_del_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let code = ctx.callbackQuery.data.replace("gc_del_", "");
  await GiftCode.deleteOne({ code, type: "redeem" });
  await ctx.answerCallbackQuery({ text: "Deleted!" }).catch(() => { });
  await renderGiftCodePanel(ctx);
});

bot.callbackQuery("adm_redeem_add", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "WAITING_REDEEM_CODES";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`➕ <b>Add Redeem Codes</b>\n\n📝 Format: <code>CODE AMOUNT</code>\n\nExample:\n<code>WELCOME100 100</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_create_gift") }).catch(() => { });
});

bot.callbackQuery("adm_amazon", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderAmazonPanel(ctx);
});

async function renderAmazonPanel(ctx) {
  const pad = "\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let codes = await GiftCode.find({ type: "amazon" }).sort({ createdAt: -1 }).limit(20).lean();
  let totalCodes = await GiftCode.countDocuments({ type: "amazon" });
  let text = `<b>Amazon Codes</b>\n\nTotal: ${totalCodes}\n\n👇 Click code to edit:`;
  let kb = new InlineKeyboard();
  for (let c of codes) {
    let shortCode = c.code.length > 15 ? c.code.substring(0, 15) + "..." : c.code;
    let status = c.usedUsers.length >= c.maxUses ? "❌" : "✅";
    kb.text(`${status} ${shortCode} — ₹${c.amount}`, `amz_view_${c.code}`).row();
  }
  kb.text(makeBtn("Add Codes"), "adm_amazon_add").row().text(makeBtn("Back"), "admin");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery(/^amz_view_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let code = ctx.callbackQuery.data.replace("amz_view_", "");
  let gc = await GiftCode.findOne({ code, type: "amazon" }).lean();
  if (!gc) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let text = `<b>Code:</b> <code>${gc.code}</code>\n\n💰 Amount: ₹${gc.amount}\n📊 Claimed: ${gc.usedUsers.length}/${gc.maxUses}`;
  let kb = new InlineKeyboard().text(makeBtn("Delete"), `amz_del_${gc.code}`).row().text(makeBtn("Back"), "adm_amazon");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^amz_del_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let code = ctx.callbackQuery.data.replace("amz_del_", "");
  await GiftCode.deleteOne({ code, type: "amazon" });
  await ctx.answerCallbackQuery({ text: "Deleted!" }).catch(() => { });
  await renderAmazonPanel(ctx);
});

bot.callbackQuery("adm_amazon_add", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "WAITING_AMAZON_CODES";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`➕ <b>Add Amazon Codes</b>\n\n📝 Format: <code>CODE AMOUNT</code>\n\nExample:\n<code>AMZ100 100</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_amazon") }).catch(() => { });
});

// ==================== BROADCAST ====================
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
  let text = `📢 <b>Broadcast Setup</b>\n\n<b>Step 1 — Send Your Message</b>\nWrite your message just like a normal Telegram chat.\n\nYou can use Telegram's built-in formatting:\n• <b>Bold</b> • <i>Italic</i> • <u>Underline</u> • <s>Strike</s> • <code>Mono</code>\n• <a href="https://t.me">Clickable Links</a> • <tg-spoiler>Spoiler</tg-spoiler>\n<blockquote>Quote 💬</blockquote>\n\n<i>No HTML or coding is required.</i>\nThe bot will send the message exactly as you format it. ✅\n\n<b>Step 2 — Choose a Send Mode</b>\n🚀 Direct Mode — Clean message (no forwarding tag)\n🔄 Forward Mode — Shows Forwarded from channel\n\n👉 <b>Now, send your message below</b> 👇`;
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
  let modeDesc = mode === "direct" ? "Clean broadcast, no forwarding tag" : "Shows 'Forwarded from channel' tag";
  let buttonCount = 0;
  if (cacheObj.buttonRows) buttonCount = cacheObj.buttonRows.reduce((s, r) => s + r.length, 0);
  let buttonText = buttonCount > 0 ? `✅ ${buttonCount} Buttons` : `❌ No Buttons`;
  let typeText = (cacheObj.type || "text").toUpperCase();
  let text = `⚠️ <b>Confirm Broadcast</b>\n\n<b>Type:</b> ${typeText}\n<b>Mode:</b> ${modeIcon} <b>${modeText}</b> (${modeDesc})\n<b>Buttons:</b> ${buttonText}\n\n<i>Select mode then click Confirm:</i>\n• 🚀 Direct Mode: Fast, clean (recommended)\n• 🔄 Forward Mode: Shows 'Forwarded from channel' tag\n\n<b>Do you want to send this message to all users?</b>`;
  let directBtn = mode === "direct" ? `✅ Direct Mode` : `Direct Mode`;
  let forwardBtn = mode === "forward" ? `✅ Forward Mode` : `Forward Mode`;
  let kb = new InlineKeyboard()
    .text(directBtn, "broadcast_mode_direct")
    .text(forwardBtn, "broadcast_mode_forward").row()
    .text(makeBtn("Add Buttons"), "broadcast_add_buttons").row()
    .text(makeBtn("Confirm & Send"), "broadcast_confirm_send")
    .text(makeBtn("Cancel"), "broadcast_cancel").row()
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
  let text = `⌨️ <b>Add Inline Buttons</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n🟢 <b>Basic Format (One Button)</b>\n<code>Button Text - https://example.com</code>\n\n🟢 <b>Multiple Buttons (New Row)</b>\n<code>Join Channel - https://t.me/YourChannel\nSupport - https://t.me/YourSupport</code>\n\n🟢 <b>Two Buttons In Same Row</b>\n<code>Join - https://t.me/A && Support - https://t.me/B</code>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 <b>Rules:</b>\n• Each new line = new row\n• Use && to place buttons in same row`;
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
    if (cacheObj.buttonRows && cacheObj.buttonRows.length > 0) inlineKb = buildInlineKeyboardFromRows(cacheObj.buttonRows);
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
        if (mode === "forward" && cacheObj.fromChatId && cacheObj.fromMessageId) await bot.api.forwardMessage(u.userId, cacheObj.fromChatId, cacheObj.fromMessageId).catch(() => { throw new Error("fwd"); });
        else {
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
  } catch (e) {
    console.error("runBroadcast error:", e.message);
  }
}

function buildStatusMessage({ running = true, modeIcon = "🚀", modeText = "DIRECT MODE", processed = 0, total = 0, success = 0, failed = 0, speed = 0 }) {
  let percent = total > 0 ? (processed / total) * 100 : 0;
  let bar = makeProgressBar(percent);
  let title = running ? `🚀 <b>Broadcast Running...</b>` : `🚀 <b>Broadcast Completed!</b>`;
  return `${title}\n\n📢 <b>Mode:</b> ${modeIcon} ${modeText}\n📊 <b>Progress:</b> ${percent.toFixed(1)}%\n${bar}\n\n👥 <b>Total Users:</b> ${total}\n✅ <b>Total Success:</b> ${success}\n❌ <b>Total Failed:</b> ${failed}\n⚡ <b>Speed:</b> ${speed.toFixed(1)} users/sec\n📈 <b>Processed:</b> ${processed} / ${total}`;
}

bot.callbackQuery(/^bc_view_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let bcId = ctx.callbackQuery.data.replace("bc_view_", "");
  let b = await Broadcast.findOne({ broadcastId: bcId }).lean();
  if (!b) return ctx.answerCallbackQuery({ text: "Not found", show_alert: true }).catch(() => { });
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let typeIcon = { text: "📝", photo: "📸", video: "🎬", audio: "🎵", document: "📄", sticker: "🎨", voice: "🎤", animation: "🎬", forward: "🔄" }[b.messageType] || "📢";
  let bodyText = `${typeIcon} Type: ${b.messageType}\n👥 Sent: ${b.sentCount}\n❌ Failed: ${b.failedCount}\n📊 Total: ${b.totalCount}\n⏱️ Time: ${b.timeTaken}s\n🕐 ${formatDateTime(b.createdAt)}\n`;
  if (b.content) bodyText += `\nContent:\n${b.content}`;
  let kb = new InlineKeyboard().text(makeBtn("🗑️ Delete"), `bc_del_${bcId}`).row().text(makeBtn("Back"), "adm_broadcast");
  await ctx.editMessageText(`📢 <b>Broadcast Details</b>\n\n<blockquote>${bodyText}</blockquote>`, { parse_mode: "HTML", reply_markup: kb }).catch(() => { });
});

bot.callbackQuery(/^bc_del_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let bcId = ctx.callbackQuery.data.replace("bc_del_", "");
  await Broadcast.deleteOne({ broadcastId: bcId });
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Broadcast Deleted", bcId, 0, null);
  await ctx.answerCallbackQuery({ text: "🗑️ Deleted!" }).catch(() => { });
  await renderBroadcastPage(ctx);
});

// ==================== CUSTOMIZE THEME ====================
bot.callbackQuery("adm_customize_theme", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let text = `<b>Customize Your Theme</b>\n\n👇 Choose what to customize:`;
  let kb = new InlineKeyboard()
    .text(makeBtn("Admin Panel Customizing"), "adm_panel_custom").row()
    .text(makeBtn("Keyboard Buttons Customizing"), "adm_keyboard_custom").row()
    .text(makeBtn("Font Editing"), "adm_font_edit").row()
    .text(makeBtn("Edit Unknown Command"), "adm_unknown_cmd").row()
    .text(makeBtn("Edit Balance Text"), "adm_edit_balance_text").row()
    .text(makeBtn("Start Command Edit"), "adm_start_edit").row()
    .text(makeBtn("Customer Support"), "adm_support").row()
    .text(makeBtn("Manage Withdraw"), "adm_manage_withdraw").row()
    .text(makeBtn("Back to Admin"), "admin");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_keyboard_custom", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderKeyboardEditPage(ctx);
});

async function renderKeyboardEditPage(ctx) {
  const pad = "\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  let text = `<b>⌨️ Keyboard Buttons Customizing</b>\n\n👇 Manage your keyboard buttons:`;
  let kb = new InlineKeyboard();
  for (let btn of layout) {
    let icon = btn.hidden ? "🙈" : "👁️";
    let label = `${btn.name.substring(0, 20)}`;
    kb.text(label, `kbc_view_${btn.key}`).text(`✏️`, `kbc_edit_${btn.key}`).text(`${icon}`, `kbc_toggle_${btn.key}`).row();
  }
  kb.text(makeBtn("Reset to Default"), "kbc_reset").row();
  kb.text(makeBtn("Back to Theme"), "adm_customize_theme");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery(/^kbc_view_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let btnKey = ctx.callbackQuery.data.replace("kbc_view_", "");
  let layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  let btn = layout.find(b => b.key === btnKey);
  if (!btn) return ctx.answerCallbackQuery({ text: "Not found", show_alert: true }).catch(() => { });
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let text = `<b>Button Info</b>\n\n📝 Name: ${btn.name}\n🔑 Key: <code>${btn.key}</code>\n📊 Row: ${btn.row}\n👁️ Status: ${btn.hidden ? "🔴 Hidden" : "🟢 Visible"}`;
  let kb = new InlineKeyboard()
    .text(makeBtn("✏️ Edit Name"), `kbc_edit_${btnKey}`).row()
    .text(makeBtn(btn.hidden ? "Show" : "Hide"), `kbc_toggle_${btnKey}`).row()
    .text(makeBtn("Move Up"), `kbc_up_${btnKey}`).text(makeBtn("Move Down"), `kbc_down_${btnKey}`).row()
    .text(makeBtn("Back"), "adm_keyboard_custom");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^kbc_edit_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let btnKey = ctx.callbackQuery.data.replace("kbc_edit_", "");
  userState[ctx.from.id] = `KBC_EDIT_NAME_${btnKey}`;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  let btn = layout.find(b => b.key === btnKey);
  await ctx.editMessageText(`✏️ <b>Edit Button Name</b>\n\n📌 Current: ${btn?.name || ""}\n\n📝 Send new name:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_keyboard_custom") }).catch(() => { });
});

bot.callbackQuery(/^kbc_toggle_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let btnKey = ctx.callbackQuery.data.replace("kbc_toggle_", "");
  let layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  let btn = layout.find(b => b.key === btnKey);
  if (!btn) return;
  btn.hidden = !btn.hidden;
  configCache.data["keyboard_layout"] = layout;
  await setConfig("keyboard_layout", layout);
  await ctx.answerCallbackQuery({ text: btn.hidden ? "🙈 Hidden" : "👁️ Visible" }).catch(() => { });
  await renderKeyboardEditPage(ctx);
});

bot.callbackQuery(/^kbc_up_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let btnKey = ctx.callbackQuery.data.replace("kbc_up_", "");
  let layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  let idx = layout.findIndex(b => b.key === btnKey);
  if (idx > 0) {
    let temp = layout[idx].row;
    layout[idx].row = layout[idx - 1].row;
    layout[idx - 1].row = temp;
    configCache.data["keyboard_layout"] = layout;
    await setConfig("keyboard_layout", layout);
  }
  await ctx.answerCallbackQuery({ text: "⬆️" }).catch(() => { });
  await renderKeyboardEditPage(ctx);
});

bot.callbackQuery(/^kbc_down_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let btnKey = ctx.callbackQuery.data.replace("kbc_down_", "");
  let layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  let idx = layout.findIndex(b => b.key === btnKey);
  if (idx < layout.length - 1) {
    let temp = layout[idx].row;
    layout[idx].row = layout[idx + 1].row;
    layout[idx + 1].row = temp;
    configCache.data["keyboard_layout"] = layout;
    await setConfig("keyboard_layout", layout);
  }
  await ctx.answerCallbackQuery({ text: "⬇️" }).catch(() => { });
  await renderKeyboardEditPage(ctx);
});

bot.callbackQuery("kbc_reset", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  configCache.data["keyboard_layout"] = DEFAULT_KEYBOARD_LAYOUT;
  await setConfig("keyboard_layout", DEFAULT_KEYBOARD_LAYOUT);
  await ctx.answerCallbackQuery({ text: "Reset!" }).catch(() => { });
  await renderKeyboardEditPage(ctx);
});

bot.callbackQuery("adm_panel_custom", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderAdminPanelEditPage(ctx);
});

async function renderAdminPanelEditPage(ctx) {
  const pad = "\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let layout = configCache.data["admin_panel_layout"] || DEFAULT_ADMIN_PANEL_LAYOUT;
  let text = `<b>Admin Panel Customizing</b>\n\n👇 Manage admin panel buttons:`;
  let kb = new InlineKeyboard();
  for (let btn of layout) {
    let icon = btn.hidden ? "🙈" : "👁️";
    let label = `${btn.name.substring(0, 20)}`;
    kb.text(label, `apc_view_${btn.key}`).text(`${icon}`, `apc_toggle_${btn.key}`).row();
  }
  kb.text(makeBtn("Reset to Default"), "apc_reset").row();
  kb.text(makeBtn("Back to Theme"), "adm_customize_theme");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery(/^apc_view_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let btnKey = ctx.callbackQuery.data.replace("apc_view_", "");
  let layout = configCache.data["admin_panel_layout"] || DEFAULT_ADMIN_PANEL_LAYOUT;
  let btn = layout.find(b => b.key === btnKey);
  if (!btn) return ctx.answerCallbackQuery({ text: "Not found", show_alert: true }).catch(() => { });
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let text = `<b>Button Info</b>\n\n📝 Name: ${btn.name}\n🔑 Key: <code>${btn.key}</code>\n👁️ Status: ${btn.hidden ? "🔴 Hidden" : "🟢 Visible"}`;
  let kb = new InlineKeyboard()
    .text(makeBtn("✏️ Edit Name"), `apc_edit_${btnKey}`).row()
    .text(makeBtn(btn.hidden ? "Show" : "Hide"), `apc_toggle_${btnKey}`).row()
    .text(makeBtn("Back"), "adm_panel_custom");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^apc_edit_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let btnKey = ctx.callbackQuery.data.replace("apc_edit_", "");
  userState[ctx.from.id] = `APC_EDIT_NAME_${btnKey}`;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`✏️ <b>Edit Button Name</b>\n\n📝 Send new name:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_panel_custom") }).catch(() => { });
});

bot.callbackQuery(/^apc_toggle_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let btnKey = ctx.callbackQuery.data.replace("apc_toggle_", "");
  let layout = configCache.data["admin_panel_layout"] || DEFAULT_ADMIN_PANEL_LAYOUT;
  let btn = layout.find(b => b.key === btnKey);
  if (!btn) return;
  btn.hidden = !btn.hidden;
  configCache.data["admin_panel_layout"] = layout;
  await setConfig("admin_panel_layout", layout);
  await ctx.answerCallbackQuery({ text: btn.hidden ? "🙈 Hidden" : "👁️ Visible" }).catch(() => { });
  await renderAdminPanelEditPage(ctx);
});

bot.callbackQuery("apc_reset", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  configCache.data["admin_panel_layout"] = DEFAULT_ADMIN_PANEL_LAYOUT;
  await setConfig("admin_panel_layout", DEFAULT_ADMIN_PANEL_LAYOUT);
  await ctx.answerCallbackQuery({ text: "Reset!" }).catch(() => { });
  await renderAdminPanelEditPage(ctx);
});

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
    "smallcaps": "ᴀᴅᴍɪɴ ᴘᴀɴᴇʟ",
    "capital_smallcaps": "Aᴅᴍɪɴ Pᴀɴᴇʟ",
    "bold": "𝐀𝐝𝐦𝐢𝐧 𝐏𝐚𝐧𝐞𝐥",
    "italic": "𝘈𝘥𝘮𝘪𝘯 𝘗𝘢𝘯𝘦𝘭",
    "bold_italic": "𝘼𝙙𝙢𝙞𝙣 𝙋𝙖𝙣𝙚𝙡",
    "monospace": "𝙰𝚍𝚖𝚒𝚗 𝙿𝚊𝚗𝚎𝚕",
    "underline": "Admin Panel",
    "strike": "Admin Panel",
    "spoiler": "Admin Panel"
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

bot.callbackQuery("adm_unknown_cmd", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderUnknownCmdPage(ctx);
});

async function renderUnknownCmdPage(ctx) {
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let isActive = await getConfig("unknown_command_active", false);
  let statusText = isActive ? "🟢 ON" : "🔴 OFF";
  let toggleText = isActive ? "Turn OFF" : "Turn ON";
  let text = `<b>Edit Unknown Command</b>\n\nStatus: ${statusText}\n\n`;
  let kb = new InlineKeyboard()
    .text(makeBtn(toggleText), "unknown_toggle").row()
    .text(makeBtn("Edit Text"), "unknown_edit_text").row()
    .text(makeBtn("Back to Theme"), "adm_customize_theme");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("unknown_toggle", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let cur = await getConfig("unknown_command_active", false);
  await setConfig("unknown_command_active", !cur);
  await ctx.answerCallbackQuery({ text: !cur ? "🟢 ON" : "🔴 OFF" }).catch(() => { });
  await renderUnknownCmdPage(ctx);
});

bot.callbackQuery("unknown_edit_text", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "UNKNOWN_CMD_EDIT_TEXT";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let currentText = await getConfig("unknown_command_text", "❓ I didn't understand that.\n\nPlease /start the bot again.");
  let displayText = escapeHtml(currentText);
  await ctx.editMessageText(`<b>Edit Text</b>\n\nCurrent Text:\n${displayText}\n\n📝 Send new text:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_unknown_cmd") }).catch(() => { });
});

bot.callbackQuery("adm_edit_balance_text", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let welcomeText = await getConfig("balance_welcome_text", DEFAULT_BALANCE_TEXT.welcome);
  let footerText = await getConfig("balance_footer_text", DEFAULT_BALANCE_TEXT.footer);
  let bodyText = `Current:\n\n${welcomeText}\n\n🔵 Wallet ID ➝ 123456789\n🧾 Balance ➝ ₹500.00\n\n❝ ${footerText} ❞`;
  let text = `<b>Edit Balance Text</b>\n\n<blockquote>${bodyText}</blockquote>\n\n👇 Choose:`;
  let kb = new InlineKeyboard()
    .text(makeBtn("Edit Welcome Message"), "adm_edit_welcome").row()
    .text(makeBtn("Edit Footer Text"), "adm_edit_footer").row()
    .text(makeBtn("Reset to Default"), "adm_reset_balance_text").row()
    .text(makeBtn("Back"), "adm_customize_theme");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_edit_welcome", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let cur = await getConfig("balance_welcome_text", DEFAULT_BALANCE_TEXT.welcome);
  userState[ctx.from.id] = "EDIT_WELCOME_TEXT";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Edit Welcome Message</b>\n\nCurrent:\n${cur}\n\n✏️ Send new message:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_edit_balance_text") }).catch(() => { });
});

bot.callbackQuery("adm_edit_footer", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let cur = await getConfig("balance_footer_text", DEFAULT_BALANCE_TEXT.footer);
  userState[ctx.from.id] = "EDIT_FOOTER_TEXT";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Edit Footer Text</b>\n\nCurrent:\n${cur}\n\n✏️ Send new footer:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_edit_balance_text") }).catch(() => { });
});

bot.callbackQuery("adm_reset_balance_text", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`⚠️ <b>Reset to Default?</b>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Yes, Reset"), "adm_reset_balance_text_yes").text(makeBtn("Cancel"), "adm_edit_balance_text") }).catch(() => { });
});

bot.callbackQuery("adm_reset_balance_text_yes", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  await setConfig("balance_welcome_text", DEFAULT_BALANCE_TEXT.welcome);
  await setConfig("balance_footer_text", DEFAULT_BALANCE_TEXT.footer);
  await ctx.answerCallbackQuery({ text: "Reset!" }).catch(() => { });
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Reset Complete!</b>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_edit_balance_text") }).catch(() => { });
});

bot.callbackQuery("adm_start_edit", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let titleText = await getConfig("start_title_text", DEFAULT_START_TEXT.title);
  let linkPrefix = await getConfig("start_link_prefix", DEFAULT_START_TEXT.linkPrefix);
  let linkClickable = await getConfig("start_link_clickable", DEFAULT_START_TEXT.linkClickable);
  let welcomeLink = await getConfig("welcome_channel_link", "https://t.me/yourchannel");
  let bodyText = `Title:\n${titleText}\n\nLink Prefix:\n${linkPrefix}\n\nClickable:\n${linkClickable}\n\nLink:\n${welcomeLink}`;
  let text = `<b>Start Command Edit</b>\n\n<blockquote>${bodyText}</blockquote>\n\n👇 Choose what to edit:`;
  let kb = new InlineKeyboard()
    .text(makeBtn("Edit Title Text"), "adm_start_edit_title").row()
    .text(makeBtn("Edit Link Prefix"), "adm_start_edit_prefix").row()
    .text(makeBtn("Edit Clickable Text"), "adm_start_edit_clickable").row()
    .text(makeBtn("Set Link URL"), "adm_start_edit_url").row()
    .text(makeBtn("Reset to Default"), "adm_start_reset").row()
    .text(makeBtn("Back"), "adm_customize_theme");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_start_edit_title", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let cur = await getConfig("start_title_text", DEFAULT_START_TEXT.title);
  userState[ctx.from.id] = "EDIT_START_TITLE";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Edit Title Text</b>\n\nCurrent:\n${cur}\n\n✏️ Send new title:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_start_edit") }).catch(() => { });
});

bot.callbackQuery("adm_start_edit_prefix", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let cur = await getConfig("start_link_prefix", DEFAULT_START_TEXT.linkPrefix);
  userState[ctx.from.id] = "EDIT_START_LINK_PREFIX";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Edit Link Prefix</b>\n\nCurrent:\n${cur}\n\n✏️ Send new prefix:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_start_edit") }).catch(() => { });
});

bot.callbackQuery("adm_start_edit_clickable", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let cur = await getConfig("start_link_clickable", DEFAULT_START_TEXT.linkClickable);
  userState[ctx.from.id] = "EDIT_START_LINK_CLICKABLE";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Edit Clickable Text</b>\n\nCurrent:\n${cur}\n\n✏️ Send new clickable text:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_start_edit") }).catch(() => { });
});

bot.callbackQuery("adm_start_edit_url", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let cur = await getConfig("welcome_channel_link", "https://t.me/yourchannel");
  userState[ctx.from.id] = "EDIT_START_URL";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Set Link URL</b>\n\n📌 Current: <code>${cur}</code>\n\n📝 Send new link:\n\nExamples:\n• <code>https://t.me/yourchannel</code>\n• <code>@yourchannel</code>\n• <code>123456789</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_start_edit") }).catch(() => { });
});

bot.callbackQuery("adm_start_reset", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`⚠️ <b>Reset Start Text?</b>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Yes, Reset"), "adm_start_reset_yes").text(makeBtn("Cancel"), "adm_start_edit") }).catch(() => { });
});

bot.callbackQuery("adm_start_reset_yes", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  await setConfig("start_title_text", DEFAULT_START_TEXT.title);
  await setConfig("start_link_prefix", DEFAULT_START_TEXT.linkPrefix);
  await setConfig("start_link_clickable", DEFAULT_START_TEXT.linkClickable);
  await ctx.answerCallbackQuery({ text: "Reset!" }).catch(() => { });
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Reset Complete!</b>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_start_edit") }).catch(() => { });
});

bot.callbackQuery("adm_support", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let current = await getConfig("support_username", "Not Set");
  let displayCurrent = current !== "Not Set" ? `<code>${current}</code>` : `<code>Not Set</code>`;
  let linkCurrent = current !== "Not Set" ? convertOwnerLink(current) : "Not Set";
  let text = `<b>Customer Support</b>\n\n📌 Current: ${displayCurrent}\n🔗 Link: ${linkCurrent}\n\n👇 Choose action:`;
  let kb = new InlineKeyboard()
    .text(makeBtn("Set Support"), "adm_support_set").row()
    .text(makeBtn("Clear"), "adm_support_clear").row()
    .text(makeBtn("Back"), "adm_customize_theme");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_support_set", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "SUPPORT_SET";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Set Customer Support</b>\n\n📝 Send your Telegram ID or Link:\n\nExamples:\n• <code>123456789</code>\n• <code>@azeeznasi</code>\n• <code>https://t.me/azeeznasi</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_support") }).catch(() => { });
});

bot.callbackQuery("adm_support_clear", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await setConfig("support_username", "Not Set");
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>Customer Support Cleared!</b>\n\n📌 Current: <code>Not Set</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_support") }).catch(() => { });
});

// ==================== FUND VERIFY + TRACK STATUS ====================
bot.callbackQuery(/^fund_verify_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id)) && !(await isOwner(ctx.from.id))) return ctx.answerCallbackQuery({ text: "❌ Unauthorized! Admin/Owner only.", show_alert: true }).catch(() => { });
  let uid = parseInt(ctx.callbackQuery.data.replace("fund_verify_", ""), 10);
  let history = await BalanceHistory.find({ userId: uid }).sort({ createdAt: -1 }).limit(30).lean();
  let bodyText = "";
  if (history.length === 0) bodyText = `No transactions.`;
  else history.forEach((h) => {
    let icon = h.amount >= 0 ? "✅" : "📤";
    let sign = h.amount >= 0 ? "+" : "";
    bodyText += `${icon} ${h.action}   ${sign}₹${Math.abs(h.amount).toFixed(2)}\n`;
  });
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.reply(`💰 <b>Fund Verify</b>\n\n<blockquote>${bodyText}</blockquote>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Close"), "noop") }).catch(() => { });
});

bot.callbackQuery(/^track_status_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id)) && !(await isOwner(ctx.from.id))) return ctx.answerCallbackQuery({ text: "❌ Unauthorized!", show_alert: true }).catch(() => { });
  let wdId = ctx.callbackQuery.data.replace("track_status_", "");
  let wd = await Withdrawal.findOne({ withdrawalId: wdId }).lean();
  if (!wd) return ctx.answerCallbackQuery({ text: "Not found", show_alert: true }).catch(() => { });
  let taxAmount = wd.taxAmount || 0;
  let netAmount = wd.netAmount || (wd.amount - taxAmount);
  let bodyText = `Request ID : #${wd.userWithdrawalCount}\nUser : ${wd.userId}\nAmount : ₹${wd.amount.toFixed(2)}\nAfter Tax : ₹${netAmount.toFixed(2)}\n\n`;
  if (wd.status === "Approved") {
    bodyText += `Status : ✅ Approved\nApproved by ${wd.approvedBy || "Admin"}\nat ${formatDateTime(wd.approvedAt || wd.createdAt)}\nTXN ID : ${wd.txnNumber}`;
  } else if (wd.status === "Rejected") {
    bodyText += `Status : ❌ Rejected\nRejected by ${wd.approvedBy || "Admin"}\nat ${formatDateTime(wd.approvedAt || wd.createdAt)}\nRefunded : ₹${wd.amount.toFixed(2)}`;
  } else {
    bodyText += `Status : ⏳ Pending\nWaiting for admin approval...`;
  }
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.reply(`🔍 <b>Track Status</b>\n\n<blockquote>${bodyText}</blockquote>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Close"), "noop") }).catch(() => { });
});

// ==================== WITHDRAWAL APPROVE / REJECT ====================
bot.callbackQuery(/^wd_app_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let wdId = ctx.callbackQuery.data.replace("wd_app_", "");
  let wd = await Withdrawal.findOne({ withdrawalId: wdId });
  if (!wd || wd.status !== "Pending") return ctx.answerCallbackQuery({ text: "Already processed", show_alert: true }).catch(() => { });
  let processTime = new Date();
  let adminTag = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || "Admin");
  wd.status = "Approved";
  if (!wd.txnNumber) wd.txnNumber = generateTxnNumber();
  wd.approvedBy = adminTag;
  wd.approvedAt = processTime;
  await wd.save();
  await LiveFund.findOneAndUpdate({ key: "main_fund" }, { $inc: { usedFund: wd.amount } }, { upsert: true });
  let serverUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  if (!serverUrl.startsWith("http")) serverUrl = `https://${serverUrl}`;
  let receiptUrl = `${serverUrl}/receipt/${wd.withdrawalId}`;
  await ctx.answerCallbackQuery({ text: "✅ Approved!" }).catch(() => { });

  let userNotified = false;
  try {
    await bot.api.sendMessage(wd.userId,
      `🎁 Your Withdrawal of Rs.<code>${wd.amount.toFixed(2)}</code> is Successfully Processed!🔥🔥\n\n` +
      `🏦 Destination ==> <code>${halfMaskDetails(wd.method, wd.details)}</code>\n` +
      `🚀 Transaction ID ==> <code>${wd.txnNumber}</code>\n\n` +
      `✅ Please Check Your ${wd.method} Account!`,
      { parse_mode: "HTML", reply_markup: new InlineKeyboard().url("✅ Check Status", receiptUrl) }
    );
    userNotified = true;
  } catch (e) { console.error("User notify fail:", e.message); }

  try {
    await bot.api.sendMessage(ctx.from.id,
      `✅ <b>Withdrawal Approved</b>\n\n` +
      `🆔 Request: #${wd.userWithdrawalCount}\n` +
      `👤 User: <code>${wd.userId}</code>\n` +
      `💰 Amount: ₹${wd.amount.toFixed(2)}\n` +
      `⚡ Method: ${wd.method}\n` +
      `🚀 TXN: <code>${wd.txnNumber}</code>\n\n` +
      `📊 Status: ✅ APPROVED\n` +
      `📅 ${formatDateTime(processTime)}\n\n` +
      `${userNotified ? "✅ User notified" : "⚠️ User notification failed (blocked)"}`,
      { parse_mode: "HTML" }
    );
  } catch (e) { }

  let maskedDetails = halfMaskDetails(wd.method, wd.details);
  let methodDisplay = wd.method.toUpperCase();
  let methodIcon = wd.method.toLowerCase() === "upi" ? "⚡" : wd.method.toLowerCase() === "bank" ? "🏦" : "🎁";
  let taxAmount = wd.taxAmount || 0;
  let netAmount = wd.netAmount || (wd.amount - taxAmount);
  await ctx.editMessageText(
    `⚠️ <b>New ${methodDisplay} Payout Request!</b> <code>(#${wd.userWithdrawalCount})</code>\n\n` +
    `User : <a href="tg://user?id=${wd.userId}"><b>${wd.userId}</b></a>\n` +
    `Request Amount : ₹<code>${wd.amount}</code>\n` +
    `Amount After Tax : ₹<code>${netAmount.toFixed(2)}</code>\n` +
    `${methodIcon} <b>${methodDisplay} ID :</b> <code>${maskedDetails}</code>\n\n` +
    `✅ ${toSmallCaps("Approved by")} ${adminTag} ${toSmallCaps("at")} ${formatDateTime(processTime)}`,
    { parse_mode: "HTML" }
  ).catch(() => { });
});

bot.callbackQuery(/^wd_rej_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let wdId = ctx.callbackQuery.data.replace("wd_rej_", "");
  let wd = await Withdrawal.findOne({ withdrawalId: wdId });
  if (!wd || wd.status !== "Pending") return ctx.answerCallbackQuery({ text: "Already processed", show_alert: true }).catch(() => { });
  let processTime = new Date();
  let adminTag = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || "Admin");
  wd.status = "Rejected";
  wd.approvedBy = adminTag;
  wd.approvedAt = processTime;
  await wd.save();
  let user = await getUser(wd.userId);
  user.balance += wd.amount;
  user.withdrawnTotal = Math.max(0, (user.withdrawnTotal || 0) - wd.amount);
  await user.save();
  await logBalanceHistory(wd.userId, "Withdrawal Refunded", wd.amount);
  await ctx.answerCallbackQuery({ text: "❌ Rejected!" }).catch(() => { });

  try {
    await bot.api.sendMessage(wd.userId,
      `❌ <b>Withdrawal Rejected</b>\n\n` +
      `💰 ₹${wd.amount.toFixed(2)}\n` +
      `💵 Refunded: ₹${user.balance.toFixed(2)}`,
      { parse_mode: "HTML" }
    ).catch(() => { });
  } catch (e) { }

  try {
    await bot.api.sendMessage(ctx.from.id,
      `❌ <b>Withdrawal Rejected</b>\n\n` +
      `🆔 Request: #${wd.userWithdrawalCount}\n` +
      `👤 User: <code>${wd.userId}</code>\n` +
      `💰 Amount: ₹${wd.amount.toFixed(2)}\n` +
      `💵 Refunded: ₹${user.balance.toFixed(2)}\n\n` +
      `📊 Status: ❌ REJECTED\n` +
      `📅 ${formatDateTime(processTime)}`,
      { parse_mode: "HTML" }
    );
  } catch (e) { }

  let maskedDetails = halfMaskDetails(wd.method, wd.details);
  let methodDisplay = wd.method.toUpperCase();
  let methodIcon = wd.method.toLowerCase() === "upi" ? "⚡" : wd.method.toLowerCase() === "bank" ? "🏦" : "🎁";
  let taxAmount = wd.taxAmount || 0;
  let netAmount = wd.netAmount || (wd.amount - taxAmount);
  await ctx.editMessageText(
    `⚠️ <b>New ${methodDisplay} Payout Request!</b> <code>(#${wd.userWithdrawalCount})</code>\n\n` +
    `User : <a href="tg://user?id=${wd.userId}"><b>${wd.userId}</b></a>\n` +
    `Request Amount : ₹<code>${wd.amount}</code>\n` +
    `Amount After Tax : ₹<code>${netAmount.toFixed(2)}</code>\n` +
    `${methodIcon} <b>${methodDisplay} ID :</b> <code>${maskedDetails}</code>\n\n` +
    `❌ ${toSmallCaps("Rejected by")} ${adminTag} ${toSmallCaps("at")} ${formatDateTime(processTime)}`,
    { parse_mode: "HTML" }
  ).catch(() => { });
});

// ==================== UPI DEPOSIT APPROVE / REJECT ====================
bot.callbackQuery(/^upi_app_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let orderId = ctx.callbackQuery.data.replace("upi_app_", "");
  let payment = await UPIPayment.findOne({ orderId });
  if (!payment || payment.status === "Approved") return ctx.answerCallbackQuery({ text: "Already processed", show_alert: true }).catch(() => { });
  payment.status = "Approved";
  payment.verifiedAt = new Date();
  payment.approvedBy = ctx.from.first_name || "Admin";
  await payment.save();
  let user = await getUser(payment.userId);
  user.balance += payment.amount;
  await user.save();
  await logBalanceHistory(payment.userId, "UPI Deposit", payment.amount);
  await ctx.answerCallbackQuery({ text: "✅ Approved!" }).catch(() => { });
  try { await bot.api.sendMessage(payment.userId, `✅ <b>${toSmallCaps("Deposit Approved!")}</b>\n\n💰 ₹${payment.amount.toFixed(2)}\n🔐 UTR: <code>${payment.utr}</code>`, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
  await ctx.editMessageText(`✅ <b>Approved</b> — ₹${payment.amount}`, { parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^upi_rej_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let orderId = ctx.callbackQuery.data.replace("upi_rej_", "");
  let payment = await UPIPayment.findOne({ orderId });
  if (!payment || payment.status === "Rejected") return ctx.answerCallbackQuery({ text: "Already processed", show_alert: true }).catch(() => { });
  payment.status = "Rejected";
  payment.approvedBy = ctx.from.first_name || "Admin";
  await payment.save();
  await ctx.answerCallbackQuery({ text: "❌ Rejected!" }).catch(() => { });
  try { await bot.api.sendMessage(payment.userId, `❌ <b>${toSmallCaps("Deposit Rejected")}</b>\n\n💰 ₹${payment.amount.toFixed(2)}\n🔐 UTR: <code>${payment.utr}</code>`, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
  await ctx.editMessageText(`❌ <b>Rejected</b> — ₹${payment.amount}`, { parse_mode: "HTML" }).catch(() => { });
});

// ==================== TASK SUBMIT (photo / forward) ====================
bot.on("message:photo", async (ctx, next) => {
  let userId = ctx.from.id;
  let state = userState[userId];

  if (state && state.startsWith("WAITING_TASK_PHOTO_")) {
    let taskId = state.replace("WAITING_TASK_PHOTO_", "");
    let task = await Task.findOne({ taskId });
    if (!task) { delete userState[userId]; return ctx.reply(`${toSmallCaps("Task not found!")}`, { parse_mode: "HTML" }).catch(() => { }); }
    if (task.completedUsers.includes(userId)) { delete userState[userId]; return ctx.reply(`${toSmallCaps("Already completed!")}`, { parse_mode: "HTML" }).catch(() => { }); }
    if (task.expiresAt && new Date(task.expiresAt) <= new Date()) { delete userState[userId]; return ctx.reply(`${toSmallCaps("Task expired!")}`, { parse_mode: "HTML" }).catch(() => { }); }
    let photo = ctx.message.photo[ctx.message.photo.length - 1];
    let submissionId = Math.floor(100000 + Math.random() * 900000).toString();
    await TaskSubmission.create({ submissionId, userId, userName: ctx.from.first_name || "User", taskId: task.taskId, taskTitle: task.title, reward: task.reward, photoFileId: photo.file_id, status: "Pending" });
    delete userState[userId];
    await ctx.reply(`${toSmallCaps("Task Submitted!")}\n\n${toSmallCaps("Task")}: ${task.title}\n${toSmallCaps("Reward")}: ₹${task.reward}\n\n🕐 ${toSmallCaps("Wait for admin approval.")}`, { parse_mode: "HTML", reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
    let alertChannel = await getConfig("default_task_alert_channel", "Not Set");
    if (alertChannel && alertChannel !== "Not Set") {
      let userLink = `<a href="tg://user?id=${userId}">${ctx.from.first_name || "User"} (${userId})</a>`;
      let caption = `<b>NEW TASK SUBMISSION</b>\n\nUser: ${userLink}\nTask: ${task.title}\nReward: ₹${task.reward}\nLink: ${task.link}\nType: Screenshot`;
      let kb = new InlineKeyboard().text("Approve ✅", `task_app_${submissionId}`).text("Reject ❌", `task_rej_${submissionId}`);
      try { await ctx.api.sendPhoto(alertChannel, photo.file_id, { caption, parse_mode: "HTML", reply_markup: kb }).catch(() => { }); } catch (e) { }
    }
    return;
  }

  if (state === "BROADCAST_WAIT_MSG" && (await isAdmin(userId))) {
    let photo = ctx.message.photo[ctx.message.photo.length - 1];
    let caption = ctx.message.caption || "";
    let htmlCaption = entitiesToHtml(caption, ctx.message.caption_entities || []);
    global.broadcastCache = global.broadcastCache || {};
    global.broadcastCache[userId] = { type: "photo", fileId: photo.file_id, caption: htmlCaption, mode: "direct", buttonRows: null, fromChatId: ctx.chat.id, fromMessageId: ctx.message.message_id };
    delete userState[userId];
    return renderBroadcastConfirm(ctx, global.broadcastCache[userId]);
  }

  if (state === "BROADCAST_TO_CHANNELS" && (await isAdmin(userId))) {
    let photo = ctx.message.photo[ctx.message.photo.length - 1];
    let caption = ctx.message.caption || "";
    let channels = await Channel.find({ isActive: true }).lean();
    let sent = 0, failed = 0;
    for (let ch of channels) {
      try { await ctx.api.sendPhoto(ch.channelId, photo.file_id, { caption }).catch(() => { throw new Error("x"); }); sent++; } catch (e) { failed++; }
    }
    delete userState[userId];
    return ctx.reply(`<b>${toSmallCaps("Broadcast Complete!")}</b>\n\n<blockquote>✅ Sent: ${sent}\n❌ Failed: ${failed}</blockquote>`, { parse_mode: "HTML" }).catch(() => { });
  }

  return sendUnknownCommand(ctx);
});

bot.on("message:video", async (ctx, next) => {
  let userId = ctx.from.id;
  let state = userState[userId];
  if (state === "BROADCAST_WAIT_MSG" && (await isAdmin(userId))) {
    let video = ctx.message.video;
    let caption = ctx.message.caption || "";
    let htmlCaption = entitiesToHtml(caption, ctx.message.caption_entities || []);
    global.broadcastCache = global.broadcastCache || {};
    global.broadcastCache[userId] = { type: "video", fileId: video.file_id, caption: htmlCaption, mode: "direct", buttonRows: null, fromChatId: ctx.chat.id, fromMessageId: ctx.message.message_id };
    delete userState[userId];
    return renderBroadcastConfirm(ctx, global.broadcastCache[userId]);
  }
  return sendUnknownCommand(ctx);
});

bot.on("message:audio", async (ctx, next) => {
  let userId = ctx.from.id;
  let state = userState[userId];
  if (state === "BROADCAST_WAIT_MSG" && (await isAdmin(userId))) {
    let audio = ctx.message.audio;
    let caption = ctx.message.caption || "";
    let htmlCaption = entitiesToHtml(caption, ctx.message.caption_entities || []);
    global.broadcastCache = global.broadcastCache || {};
    global.broadcastCache[userId] = { type: "audio", fileId: audio.file_id, caption: htmlCaption, mode: "direct", buttonRows: null, fromChatId: ctx.chat.id, fromMessageId: ctx.message.message_id };
    delete userState[userId];
    return renderBroadcastConfirm(ctx, global.broadcastCache[userId]);
  }
  return sendUnknownCommand(ctx);
});

bot.on("message:document", async (ctx, next) => {
  let userId = ctx.from.id;
  let state = userState[userId];
  if (state === "BROADCAST_WAIT_MSG" && (await isAdmin(userId))) {
    let doc = ctx.message.document;
    let caption = ctx.message.caption || "";
    let htmlCaption = entitiesToHtml(caption, ctx.message.caption_entities || []);
    global.broadcastCache = global.broadcastCache || {};
    global.broadcastCache[userId] = { type: "document", fileId: doc.file_id, caption: htmlCaption, mode: "direct", buttonRows: null, fromChatId: ctx.chat.id, fromMessageId: ctx.message.message_id };
    delete userState[userId];
    return renderBroadcastConfirm(ctx, global.broadcastCache[userId]);
  }
  return sendUnknownCommand(ctx);
});

bot.on("message:sticker", async (ctx, next) => {
  let userId = ctx.from.id;
  let state = userState[userId];
  if (state === "BROADCAST_WAIT_MSG" && (await isAdmin(userId))) {
    let sticker = ctx.message.sticker;
    global.broadcastCache = global.broadcastCache || {};
    global.broadcastCache[userId] = { type: "sticker", fileId: sticker.file_id, mode: "direct", buttonRows: null, fromChatId: ctx.chat.id, fromMessageId: ctx.message.message_id };
    delete userState[userId];
    return renderBroadcastConfirm(ctx, global.broadcastCache[userId]);
  }
  return sendUnknownCommand(ctx);
});

bot.on("message:voice", async (ctx, next) => {
  let userId = ctx.from.id;
  let state = userState[userId];
  if (state === "BROADCAST_WAIT_MSG" && (await isAdmin(userId))) {
    let voice = ctx.message.voice;
    global.broadcastCache = global.broadcastCache || {};
    global.broadcastCache[userId] = { type: "voice", fileId: voice.file_id, mode: "direct", buttonRows: null, fromChatId: ctx.chat.id, fromMessageId: ctx.message.message_id };
    delete userState[userId];
    return renderBroadcastConfirm(ctx, global.broadcastCache[userId]);
  }
  return sendUnknownCommand(ctx);
});

bot.on("message:animation", async (ctx, next) => {
  let userId = ctx.from.id;
  let state = userState[userId];
  if (state === "BROADCAST_WAIT_MSG" && (await isAdmin(userId))) {
    let anim = ctx.message.animation;
    let caption = ctx.message.caption || "";
    let htmlCaption = entitiesToHtml(caption, ctx.message.caption_entities || []);
    global.broadcastCache = global.broadcastCache || {};
    global.broadcastCache[userId] = { type: "animation", fileId: anim.file_id, caption: htmlCaption, mode: "direct", buttonRows: null, fromChatId: ctx.chat.id, fromMessageId: ctx.message.message_id };
    delete userState[userId];
    return renderBroadcastConfirm(ctx, global.broadcastCache[userId]);
  }
  return sendUnknownCommand(ctx);
});

bot.on("message:users_shared", async (ctx) => {
  let userId = ctx.from.id;
  let state = userState[userId];
  if (state !== "QP_WAIT_INPUT") return;
  let shared = ctx.message.users_shared;
  if (!shared || !shared.users || shared.users.length === 0) return;
  let targetId = shared.users[0].user_id;
  let dbUser = await User.findOne({ userId: targetId }).lean();
  if (!dbUser) return ctx.reply(`${toSmallCaps("User not found in bot!")}\n\n${toSmallCaps("Ask them to start the bot.")}`, { parse_mode: "HTML" }).catch(() => { });
  if (targetId === userId) return ctx.reply(`❌ ${toSmallCaps("Cannot pay yourself")}`, { parse_mode: "HTML" }).catch(() => { });
  userState[userId] = `QP_AMOUNT_${targetId}`;
  let bodyText = `${toSmallCaps("Name")}: ${dbUser.firstName || "User"}\n${toSmallCaps("User ID")}: ${targetId}\n${toSmallCaps("Username")}: ${dbUser.username ? "@" + dbUser.username : "None"}`;
  await ctx.reply(`<b>${toSmallCaps("User Selected")}</b>\n\n<blockquote>${bodyText}</blockquote>\n\n${toSmallCaps("Enter Amount:")}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(`${toSmallCaps("Cancel")} ❌`, "qp_cancel") }).catch(() => { });
});

bot.on("message", async (ctx, next) => {
  let userId = ctx.from.id;
  let state = userState[userId];

  if (state === "BROADCAST_WAIT_MSG" && (await isAdmin(userId))) {
    let msg = ctx.message;
    let isForwarded = msg.forward_origin || msg.forward_from || msg.forward_from_chat || msg.forward_sender_name;
    if (isForwarded) {
      global.broadcastCache = global.broadcastCache || {};
      global.broadcastCache[userId] = { type: "forward", mode: "forward", buttonRows: null, fromChatId: ctx.chat.id, fromMessageId: msg.message_id };
      delete userState[userId];
      return renderBroadcastConfirm(ctx, global.broadcastCache[userId]);
    }
  }

  if (!state || !state.startsWith("TASK_REFER_")) return next();
  let msg = ctx.message;
  let isForwarded = msg.forward_origin || msg.forward_from || msg.forward_from_chat || msg.forward_sender_name;
  if (!isForwarded) return next();
  let taskId = state.replace("TASK_REFER_", "");
  delete userState[userId];
  let task = await Task.findOne({ taskId });
  if (!task) return ctx.reply(`❌ ${toSmallCaps("Task not found")}`).catch(() => { });
  if (task.completedUsers.includes(userId)) return ctx.reply(`❌ ${toSmallCaps("Already completed!")}`).catch(() => { });
  if (task.expiresAt && new Date(task.expiresAt) <= new Date()) return ctx.reply(`❌ ${toSmallCaps("Task expired!")}`).catch(() => { });
  let referValue = "";
  if (msg.forward_origin) {
    if (msg.forward_origin.type === "channel") referValue = `Channel: ${msg.forward_origin.chat.title || msg.forward_origin.chat.username || msg.forward_origin.chat.id}`;
    else if (msg.forward_origin.type === "user") referValue = `User: ${msg.forward_origin.sender_user.first_name || msg.forward_origin.sender_user.id}`;
    else if (msg.forward_origin.type === "hidden_user") referValue = `Hidden: ${msg.forward_origin.sender_user_name}`;
  } else if (msg.forward_from_chat) referValue = `Channel: ${msg.forward_from_chat.title || msg.forward_from_chat.username || msg.forward_from_chat.id}`;
  else if (msg.forward_from) referValue = `User: ${msg.forward_from.first_name || msg.forward_from.id}`;
  else if (msg.forward_sender_name) referValue = `Sender: ${msg.forward_sender_name}`;
  if (!referValue) referValue = "Forwarded message";
  let submissionId = Math.floor(100000 + Math.random() * 900000).toString();
  let user = await getUser(userId);
  await TaskSubmission.create({ submissionId, userId, userName: user.firstName || "User", taskId: task.taskId, taskTitle: task.title, reward: task.reward, photoFileId: `REFER: ${referValue}`, status: "Pending" });
  let alertChannel = await getConfig("default_task_alert_channel", "Not Set");
  if (alertChannel && alertChannel !== "Not Set") {
    let forwardedMsgId = null;
    try { let fwd = await ctx.api.forwardMessage(alertChannel, ctx.chat.id, ctx.message.message_id); forwardedMsgId = fwd.message_id; } catch (e) { }
    let userLink = `<a href="tg://user?id=${userId}">${user.firstName || "User"} (${userId})</a>`;
    let caption = `<b>NEW TASK SUBMISSION</b>\n\nUser: ${userLink}\nTask: ${task.title}\nReward: ₹${task.reward}\nLink: ${task.link}\nType: Refer`;
    let kb = new InlineKeyboard().text("Approve ✅", `task_app_${submissionId}`).text("Reject ❌", `task_rej_${submissionId}`);
    let sendOpts = { parse_mode: "HTML", reply_markup: kb };
    if (forwardedMsgId) sendOpts.reply_parameters = { message_id: forwardedMsgId };
    try { await ctx.api.sendMessage(alertChannel, caption, sendOpts).catch(() => { }); } catch (e) { }
  }
  return ctx.reply(`${toSmallCaps("Task Submitted!")}\n\n${toSmallCaps("Task")}: ${task.title}\n${toSmallCaps("Reward")}: ₹${task.reward}\n\n${toSmallCaps("Wait for admin approval.")}`, { parse_mode: "HTML", reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
});

// ==================== TASK CALLBACKS ====================
bot.callbackQuery(/^do_task_/, async (ctx) => {
  let userId = ctx.from.id;
  let taskId = ctx.callbackQuery.data.replace("do_task_", "");
  let task = await Task.findOne({ taskId });
  if (!task) return ctx.answerCallbackQuery({ text: "Task not found", show_alert: true }).catch(() => { });
  if (task.completedUsers.includes(userId)) return ctx.answerCallbackQuery({ text: "You have already submitted this task!", show_alert: true }).catch(() => { });
  if (task.expiresAt && new Date(task.expiresAt) <= new Date()) {
    await ctx.answerCallbackQuery({ text: "Task expired", show_alert: true }).catch(() => { });
    const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
    const makeBtn = (text) => `${pad}${text}${pad}`;
    return ctx.editMessageText(`<b>${toSmallCaps("Task Expired")}</b>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "back_to_tasks") }).catch(() => { });
  }
  await ctx.answerCallbackQuery().catch(() => { });
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let bodyText = `${toSmallCaps("Task Name")}: ${task.title}\n${toSmallCaps("Reward")}: ₹${task.reward}\n${toSmallCaps("Link")}: ${task.link}`;
  await ctx.editMessageText(`<b>${toSmallCaps("Task Details")}</b>\n\n<blockquote>${bodyText}</blockquote>`, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .url(`${toSmallCaps("Task Link")}`, task.link).row()
      .text(makeBtn(`${toSmallCaps("Upload Screenshot")}`), `task_upload_${taskId}`).row()
      .text(makeBtn(`${toSmallCaps("Send Refer Link / Number")}`), `task_refer_${taskId}`).row()
      .text(makeBtn("Back"), "back_to_tasks")
  }).catch(() => { });
});

bot.callbackQuery("back_to_tasks", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  let tasks = await Task.find({ isActive: { $ne: false }, isComplete: true }).sort({ createdAt: -1 }).lean();
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  if (!tasks || tasks.length === 0) return ctx.editMessageText(`<b>${toSmallCaps("Available Tasks")}</b>\n\n${toSmallCaps("No tasks available.")}`, { parse_mode: "HTML" }).catch(() => { });
  let taskButtons = [];
  tasks.forEach(t => taskButtons.push([{ text: `${t.title} (₹${t.reward})`, callback_data: `do_task_${t.taskId}` }]));
  taskButtons.push([{ text: makeBtn("Back"), callback_data: "back_to_balance" }]);
  return ctx.editMessageText(`<b>${toSmallCaps("Available Tasks")}</b>`, { reply_markup: await buildStyledKb(taskButtons), parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("canc_task", async (ctx) => {
  delete userState[ctx.from.id];
  ctx.answerCallbackQuery({ text: "Cancelled" }).catch(() => { });
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`${toSmallCaps("Cancelled")}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "back_to_balance") }).catch(() => { });
});

bot.callbackQuery(/^task_upload_/, async (ctx) => {
  let userId = ctx.from.id;
  let taskId = ctx.callbackQuery.data.replace("task_upload_", "");
  let task = await Task.findOne({ taskId });
  if (!task) return ctx.answerCallbackQuery({ text: "Task not found", show_alert: true }).catch(() => { });
  if (task.completedUsers.includes(userId)) return ctx.answerCallbackQuery({ text: "Already submitted!", show_alert: true }).catch(() => { });
  await ctx.answerCallbackQuery().catch(() => { });
  userState[userId] = `WAITING_TASK_PHOTO_${taskId}`;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>${toSmallCaps("Upload Screenshot")}</b>\n\n${toSmallCaps("Send your task completion screenshot")}:\n\n${toSmallCaps("Task")}: ${task.title}\n${toSmallCaps("Reward")}: ₹${task.reward}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "canc_task") }).catch(() => { });
});

bot.callbackQuery(/^task_refer_/, async (ctx) => {
  let userId = ctx.from.id;
  let taskId = ctx.callbackQuery.data.replace("task_refer_", "");
  let task = await Task.findOne({ taskId });
  if (!task) return ctx.answerCallbackQuery({ text: "Task not found", show_alert: true }).catch(() => { });
  if (task.completedUsers.includes(userId)) return ctx.answerCallbackQuery({ text: "Already submitted!", show_alert: true }).catch(() => { });
  await ctx.answerCallbackQuery().catch(() => { });
  userState[userId] = `TASK_REFER_${taskId}`;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`<b>${toSmallCaps("Send Refer Link / Number")}</b>\n\n${toSmallCaps("Send refer link OR your 10-digit number")}:\n\n${toSmallCaps("Examples")}:\n• https://t.me/yourlink\n• 9876543210\n• (forwarded message)\n\n${toSmallCaps("Task")}: ${task.title}\n${toSmallCaps("Reward")}: ₹${task.reward}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "canc_task") }).catch(() => { });
});

bot.callbackQuery(/^task_app_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let subId = ctx.callbackQuery.data.replace("task_app_", "");
  let sub = await TaskSubmission.findOne({ submissionId: subId });
  if (!sub || sub.status !== "Pending") return ctx.answerCallbackQuery({ text: "Processed!", show_alert: true }).catch(() => { });
  sub.status = "Approved";
  await sub.save();
  let user = await getUser(sub.userId);
  user.balance += sub.reward;
  await user.save();
  await logBalanceHistory(sub.userId, `Task Approved (${sub.taskTitle})`, sub.reward);
  await Task.updateOne({ taskId: sub.taskId }, { $addToSet: { completedUsers: sub.userId } });
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Task Approved", sub.taskTitle, sub.reward, sub.userId);
  await ctx.answerCallbackQuery({ text: "Approved!" }).catch(() => { });
  let msg = ctx.callbackQuery.message;
  if (msg.photo) await ctx.editMessageCaption({ caption: (msg.caption || "") + `\n\nAPPROVED` }).catch(() => { });
  else await ctx.editMessageText((msg.text || "") + `\n\nAPPROVED`).catch(() => { });
  try { await ctx.api.sendMessage(sub.userId, `<b>${toSmallCaps("Task Approved!")}</b>\n\n${toSmallCaps("Task")}: ${sub.taskTitle}\n${toSmallCaps("Reward")}: ₹${sub.reward}`, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
});

bot.callbackQuery(/^task_rej_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  let subId = ctx.callbackQuery.data.replace("task_rej_", "");
  let sub = await TaskSubmission.findOne({ submissionId: subId });
  if (!sub || sub.status !== "Pending") return ctx.answerCallbackQuery({ text: "Processed!", show_alert: true }).catch(() => { });
  sub.status = "Rejected";
  await sub.save();
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Task Rejected", sub.taskTitle, sub.reward, sub.userId);
  await ctx.answerCallbackQuery({ text: "Rejected!" }).catch(() => { });
  let msg = ctx.callbackQuery.message;
  if (msg.photo) await ctx.editMessageCaption({ caption: (msg.caption || "") + `\n\nREJECTED` }).catch(() => { });
  else await ctx.editMessageText((msg.text || "") + `\n\nREJECTED`).catch(() => { });
  try { await ctx.api.sendMessage(sub.userId, `<b>${toSmallCaps("Task Rejected")}</b>\n\n${toSmallCaps("Task")}: ${sub.taskTitle}\n${toSmallCaps("Reward")}: ₹${sub.reward}`, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
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
  let history = await BalanceHistory.find({ userId }).sort({ createdAt: -1 }).limit(30).lean();
  let user = await getUser(userId);
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let bodyText = `${toSmallCaps("Wallet ID")}: ${userId}\n${toSmallCaps("Balance")}: ${formatBalance(user.balance)}\n\n`;
  if (history.length === 0) bodyText += `📭 No transactions.`;
  else {
    let totalIn = 0, totalOut = 0;
    history.forEach((h) => {
      let icon = h.amount >= 0 ? "🟢" : "🔴";
      let sign = h.amount >= 0 ? "+" : "";
      bodyText += `${icon} ${h.action}\n   ${sign}₹${h.amount.toFixed(2)} • ${formatDateTime(h.createdAt)}\n\n`;
      if (h.amount >= 0) totalIn += h.amount; else totalOut += Math.abs(h.amount);
    });
    bodyText += `━━━━━━━━━━━━━━━━━━━━\n🟢 Earned: ₹${totalIn.toFixed(2)}\n🔴 Spent: ₹${totalOut.toFixed(2)}`;
  }
  let kb = new InlineKeyboard().text(makeBtn("Refresh"), "balance_statement").row().text(makeBtn("Back"), "back_to_balance");
  await ctx.editMessageText(`<b>${toSmallCaps("Balance Statement")}</b>\n\n<blockquote>${bodyText}</blockquote>`, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("noop", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "OK", show_alert: false }).catch(() => { });
});

bot.callbackQuery("live_fund", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Loading..." }).catch(() => { });
  let users = await User.find({}).lean();
  let totalBalance = 0;
  users.forEach(u => { totalBalance += u.balance; });
  let liveFund = await LiveFund.findOne({ key: "main_fund" }).lean();
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let bodyText = `Users: ${users.length}\nTotal: ₹${totalBalance.toFixed(2)}`;
  if (liveFund && liveFund.isActive) {
    let running = (liveFund.totalFund || 0) - (liveFund.usedFund || 0);
    bodyText += `\n\nLive Fund:\n💰 Set Fund: ₹${(liveFund.totalFund || 0).toFixed(2)}\n📉 Running: ₹${running.toFixed(2)}\n📊 Used: ₹${(liveFund.usedFund || 0).toFixed(2)}`;
  }
  let kb = new InlineKeyboard().text(makeBtn("Refresh"), "live_fund").row().text(makeBtn("Back"), "back_to_balance");
  await ctx.editMessageText(`<b>${toSmallCaps("Live Fund Report")}</b>\n\n<blockquote>${bodyText}</blockquote>`, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("user_deposit", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  let depositEnabled = await getConfig("deposit_enabled", false);
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  if (!depositEnabled) {
    let msg = await getConfig("deposit_message", "Deposit is currently unavailable. Please contact support.");
    return ctx.editMessageText(`⚠️ <b>Deposit</b>\n\n${msg}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "back_to_balance") }).catch(() => { });
  }
  return ctx.editMessageText(`⚠️ <b>Deposit</b>\n\nDeposit service unavailable.`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "back_to_balance") }).catch(() => { });
});

// ==================== PAYOUT METHOD ====================
bot.callbackQuery("set_upi", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  userState[ctx.from.id] = "SET_UPI_ACC";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`📝 Send your UPI ID:\n\nExample: <code>yourname@upi</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "btn_payout_back") }).catch(() => { });
});

bot.callbackQuery("set_wallet_number", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  userState[ctx.from.id] = "SET_WALLET_NUMBER";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`📝 Send your Wallet Number (10-12 digits):`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "btn_payout_back") }).catch(() => { });
});

bot.callbackQuery("set_bank", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  userState[ctx.from.id] = "SET_BANK_ACCNO";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`🏦 Send Your Bank Account Number (9-18 digits):`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "btn_payout_back") }).catch(() => { });
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
    return ctx.editMessageText(`<b>${toSmallCaps("Choose Withdraw Method")}</b>\n\n❌ ${toSmallCaps("No withdraw methods available.")}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "back_to_balance") }).catch(() => { });
  }
  await ctx.editMessageText(`<b>${toSmallCaps("Choose Withdraw Method")}</b>`, { reply_markup: await buildStyledKb(buttons), parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("wd_cancel", async (ctx) => {
  ctx.answerCallbackQuery({ text: "Cancelled" }).catch(() => { });
  delete userState[ctx.from.id];
  await sendBalancePage(ctx, true, false);
});

// ==================== GATEWAY WITHDRAWAL ====================
bot.callbackQuery(/^wd_gw_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  let userId = ctx.from.id;
  let gwName = ctx.callbackQuery.data.replace("wd_gw_", "");
  let gateway = await Gateway.findOne({ name: gwName, isActive: true });
  if (!gateway) return ctx.answerCallbackQuery({ text: "Gateway not available", show_alert: true }).catch(() => { });
  let user = await getUser(userId);
  let wallet = user.walletNumber || "";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  if (!wallet) {
    userState[userId] = `GW_NUMBER_${gwName}`;
    let kb = new Keyboard().text("Cancel").resized().oneTime();
    return ctx.reply(`📝 Send Your Wallet Number (10-12 digits):`, { reply_markup: kb }).catch(() => { });
  }
  userState[userId] = `GW_AMOUNT_${gwName}`;
  let kb = new Keyboard().text("Cancel").resized().oneTime();
  await ctx.reply(`Enter Withdraw Amount`, { reply_markup: kb }).catch(() => { });
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

    let taxPercent = gateway.taxPercent || 0;
    let taxAmount = taxPercent > 0 ? (amount * taxPercent) / 100 : 0;
    let netAmount = amount - taxAmount;

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
    let result = await processGatewayPayout({ bot, userId, amount, gatewayInfo: gateway, wallet, channelList, showRemainingBalance: true });
    clearInterval(animInterval);

    const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
    const makeBtn = (text) => `${pad}${text}${pad}`;

    if (result.status === "success") {
      let txnNumber = result.txnNumber || generateTxnNumber();
      let processTime = new Date();
      await Withdrawal.create({ withdrawalId, userId, userWithdrawalCount, amount, method: gwName, details: wallet, status: "Approved", isGateway: true, gatewayName: gateway.name, gatewayResponse: result.rawResponse || "", txnNumber, taxPercent, taxAmount, netAmount, approvedBy: "Auto Gateway", approvedAt: processTime });
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
  } catch (e) {
    console.error("gw_conf_yes_ error:", e.message);
  }
});

bot.callbackQuery("gw_conf_no", async (ctx) => {
  ctx.answerCallbackQuery({ text: "Cancelled" }).catch(() => { });
  delete userState[ctx.from.id];
  await sendBalancePage(ctx, true, false);
});

// ==================== AUTO UPI USER WITHDRAWAL ====================
bot.callbackQuery(/^wd_auto_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  let userId = ctx.from.id;
  let gwId = ctx.callbackQuery.data.replace("wd_auto_", "");
  let gw = await AutoUpi.findOne({ gatewayId: gwId, status: "active" });
  if (!gw) return ctx.answerCallbackQuery({ text: "Not available", show_alert: true }).catch(() => { });
  let user = await getUser(userId);
  if (!user.upiId || user.upiId === "Not Set") {
    return ctx.editMessageText(`❌ <b>UPI Not Linked</b>\n\nPlease link UPI from Payout Method first.`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("Payout Method", "btn_payout_back").text("Back", "back_to_withdraw") }).catch(() => { });
  }
  userState[userId] = `MANUAL_AMOUNT_auto_upi_${gwId}`;
  let kb = new Keyboard().text("Cancel").resized().oneTime();
  await ctx.reply(`Enter Withdraw Amount`, { reply_markup: kb }).catch(() => { });
});

bot.callbackQuery("auto_upi_cancel", async (ctx) => {
  ctx.answerCallbackQuery({ text: "Cancelled" }).catch(() => { });
  delete userState[ctx.from.id];
  await sendBalancePage(ctx, true, false);
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

    let taxPercent = gw.taxPercent || 0;
    let taxAmount = taxPercent > 0 ? (amount * taxPercent) / 100 : 0;
    let netAmount = amount - taxAmount;

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
    try {
      result = await processAutoUpiPayout({ bot, userId, amount, gateway: gw, upiId });
    } finally {
      clearInterval(animInterval);
    }

    const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
    const makeBtn = (text) => `${pad}${text}${pad}`;
    let maskedUPI = halfMaskUPI(upiId);

    if (result.status === "success") {
      let txnNumber = result.txnNumber || generateTxnNumber();
      let processTime = new Date();
      await Withdrawal.create({ withdrawalId: Math.floor(100000 + Math.random() * 900000).toString(), userId, amount, method: `AUTO_UPI_${gw.name}`, details: upiId, status: "Approved", isGateway: true, gatewayName: gw.name, gatewayResponse: result.rawResponse || "", txnNumber, taxPercent, taxAmount, netAmount, approvedBy: "Auto UPI", approvedAt: processTime });
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
  } catch (e) {
    console.error("auto_upi_confirm error:", e.message);
  }
});

// ==================== MANUAL WITHDRAWAL ====================
bot.callbackQuery(/^wd_(upi|bank|amazon|redeem)$/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  let userId = ctx.from.id;
  let method = ctx.callbackQuery.data.replace("wd_", "");
  let user = await getUser(userId);
  let details = "";
  if (method === "upi") details = user.upiId;
  else if (method === "bank") details = (user.bankAccNo && user.bankAccNo !== "Not Set") ? `${user.bankAccNo}, ${user.bankIfsc}` : "";
  else if (method === "amazon") details = user.amazonEmail;
  else if (method === "redeem") details = user.redeemCodeAddr;
  if (!details || details === "Not Set" || details.includes("Not Set")) {
    let stateKey = "";
    if (method === "upi") stateKey = "WD_ADD_UPI";
    else if (method === "bank") stateKey = "WD_ADD_BANK_ACCNO";
    else if (method === "amazon") stateKey = "WD_ADD_AMAZON";
    else if (method === "redeem") stateKey = "WD_ADD_REDEEM";
    userState[userId] = stateKey;
    let kb = new Keyboard().text("Cancel").resized().oneTime();
    return ctx.reply(`${method.toUpperCase()} not linked!\n\nSend your ${method.toUpperCase()} details:`, { reply_markup: kb }).catch(() => { });
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
    let details = "";
    if (method === "upi") details = user.upiId;
    else if (method === "bank") details = (user.bankAccNo && user.bankAccNo !== "Not Set") ? `${user.bankAccNo}, ${user.bankIfsc}` : "";
    else if (method === "amazon") details = user.amazonEmail;
    else if (method === "redeem") details = user.redeemCodeAddr;
    if (!details || details === "Not Set" || details.includes("Not Set")) return ctx.editMessageText(`❌ Method not linked!`, { parse_mode: "HTML" }).catch(() => { });
    let ws = await WithdrawSettings.findOne({ method }).lean();
    let minW = ws ? ws.minAmount : 0;
    let maxW = ws ? ws.maxAmount : 0;
    if (minW > 0 && amount < minW) return ctx.editMessageText(`❌ Minimum: ₹${minW}`, { parse_mode: "HTML" }).catch(() => { });
    if (maxW > 0 && amount > maxW) return ctx.editMessageText(`❌ Maximum: ₹${maxW}`, { parse_mode: "HTML" }).catch(() => { });
    if (user.balance < amount) return ctx.editMessageText(`❌ Insufficient balance!`, { parse_mode: "HTML" }).catch(() => { });

    let taxPercent = ws ? ws.taxPercent : 0;
    let taxAmount = taxPercent > 0 ? (amount * taxPercent) / 100 : 0;
    let netAmount = amount - taxAmount;

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
    let txnNumber = generateTxnNumber();
    await Withdrawal.create({ withdrawalId, userId, userWithdrawalCount, amount, method: methodLabel, details, status: "Pending", isGateway: false, txnNumber, taxPercent, taxAmount, netAmount });
    let payoutChannel = await getPayoutChannel(method);
    if (payoutChannel && payoutChannel !== "Not Set") {
      const adminKb = new InlineKeyboard().text("Approve ✅", `wd_app_${withdrawalId}`).text("Reject ❌", `wd_rej_${withdrawalId}`);
      const userLink = `<a href="tg://user?id=${userId}"><b>${userId}</b></a>`;
      const hashTag = `<code>(#${userWithdrawalCount})</code>`;
      const methodIcon = method === "upi" ? "⚡" : method === "bank" ? "🏦" : method === "amazon" ? "📧" : "🎁";
      try {
        await bot.api.sendMessage(payoutChannel,
          `⚠️ <b>New ${methodLabel} Payout Request!</b> ${hashTag}\n\n` +
          `User : ${userLink}\n` +
          `Request Amount : ₹<code>${amount}</code>\n` +
          `Amount After Tax : ₹<code>${netAmount.toFixed(2)}</code>\n` +
          `${methodIcon} <b>${methodLabel} ID :</b> <code>${details}</code>\n\n` +
          `📊 <b>Status:</b> ⏳ Pending`,
          { parse_mode: "HTML", reply_markup: adminKb, disable_web_page_preview: true }
        ).catch(() => { });
      } catch (e) { console.error("Payout channel error:", e.message); }
    }
    const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
    const makeBtn = (text) => `${pad}${text}${pad}`;
    const methodIcon2 = method === "upi" ? "⚡" : method === "bank" ? "🏦" : method === "amazon" ? "📧" : "🎁";
    await ctx.editMessageText(
      `✅ <b>${toSmallCaps("Withdrawal Request Submitted!")}</b>\n\n` +
      `💰 ${toSmallCaps("Amount")}: ₹${amount.toFixed(2)}\n` +
      `${methodIcon2} ${methodLabel} ID: <code>${halfMaskDetails(methodLabel, details)}</code>\n` +
      `🆔 ${toSmallCaps("ID")}: <code>${withdrawalId}</code>\n\n` +
      `⏳ ${toSmallCaps("Waiting for admin approval...")}\n` +
      `💵 ${toSmallCaps("New Balance")}: ₹${user.balance.toFixed(2)}`,
      { parse_mode: "HTML" }
    ).catch(() => { });
    let restoreKb = await buildKeyboardFromLayout(userId);
    await ctx.reply(" ", { reply_markup: restoreKb }).then(m => ctx.api.deleteMessage(ctx.chat.id, m.message_id).catch(() => { })).catch(() => { });
  } catch (e) {
    console.error("man_conf_yes error:", e.message);
  }
});

bot.callbackQuery("man_conf_no", async (ctx) => {
  ctx.answerCallbackQuery({ text: "Cancelled" }).catch(() => { });
  delete userState[ctx.from.id];
  await sendBalancePage(ctx, true, false);
});

// ==================== QUICK PAY ====================
bot.callbackQuery("qp_cancel", async (ctx) => {
  let userId = ctx.from.id;
  delete userState[userId];
  if (global.quickPayCache) delete global.quickPayCache[userId];
  await ctx.answerCallbackQuery({ text: "Cancelled!" }).catch(() => { });
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`${toSmallCaps("Cancelled")}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "back_to_balance") }).catch(() => { });
  let restoreKb = await buildKeyboardFromLayout(userId);
  await ctx.reply(" ", { reply_markup: restoreKb }).then(m => ctx.api.deleteMessage(ctx.chat.id, m.message_id).catch(() => { })).catch(() => { });
});

bot.callbackQuery("qp_retry", async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => { });
  let userId = ctx.from.id;
  userState[userId] = "QP_WAIT_INPUT";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let title = `💡${toSmallCaps("Quick Pay To a Simple User Payment Send")}`;
  let openingUsername = ctx.from.username ? `@${ctx.from.username}` : "No Username";
  let adminId = await getConfig("owner_id", MAIN_OWNER_ID);
  let bodyText = `${toSmallCaps("You Can Also Use The Format Below:")}\n\n<code>${userId} 5</code>     <code>${openingUsername} 5</code>\n<code>${adminId} 10</code>     <code>@username 10</code>`;
  await ctx.editMessageText(`${title}\n\n<blockquote>${bodyText}</blockquote>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "qp_cancel") }).catch(() => { });
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
    let receiverAmount = taxPercent > 0 ? (totalAmount - taxAmount) / payments.length : totalAmount / payments.length;
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
        await ctx.api.sendMessage(receiver.userId, `💸 ${toSmallCaps("You Received")} ₹${addAmount.toFixed(2)} ${toSmallCaps("From")} ${senderLink}`, { parse_mode: "HTML", link_preview_options: { is_disabled: true } }).catch(() => { });
      } catch (e) { }
    }
    let bodyText = "";
    resultList.forEach((r, i) => { bodyText += `${i + 1}. ${r.firstName} (${r.userId})\nAmount: ₹${r.amount.toFixed(2)}\nBalance: ₹${r.after.toFixed(2)}\n\n`; });
    bodyText += `Total Users: ${resultList.length}\nTotal Sent: ₹${totalAmount.toFixed(2)}\n`;
    if (skipBalance) bodyText += `Mode: 👑 Admin/Owner (Unlimited)`;
    else bodyText += `Your Balance: ₹${senderBefore.toFixed(2)} → ₹${sender.balance.toFixed(2)}`;
    const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
    const makeBtn = (text) => `${pad}${text}${pad}`;
    await ctx.editMessageText(`<b>${toSmallCaps("Payment Successful")}</b>\n\n<blockquote>${bodyText}</blockquote>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "back_to_balance") }).catch(() => { });
    let restoreKb = await buildKeyboardFromLayout(userId);
    await ctx.reply(" ", { reply_markup: restoreKb }).then(m => ctx.api.deleteMessage(ctx.chat.id, m.message_id).catch(() => { })).catch(() => { });
  } catch (e) {
    console.error("qp_confirm_multi error:", e.message);
  }
});

// ==================== HANDLE ADMIN TEXT INPUT ====================
async function handleAdminTextInput(ctx, text, userId, state) {
  try {
    const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
    const makeBtn = (text) => `${pad}${text}${pad}`;
    if (!(await isAdmin(userId))) return false;

    const adminOnlyPrefixes = [
      "BROADCAST_WAIT_MSG", "BROADCAST_ADD_BUTTONS", "BROADCAST_TO_CHANNELS",
      "WAITING_ADMIN_ADD", "WAITING_NEW_OWNER", "WAITING_TAX_PERCENT", "QP_SET_TAX",
      "BAN_USER_WAIT", "UNBAN_USER_WAIT", "BAN_WALLET_WAIT",
      "WAITING_FOR_ADD_BAL", "WAITING_FOR_REM_BAL", "WAITING_FOR_TRACKER_ID", "WAITING_FOR_USER_MESSAGE",
      "TASK_FIELD_NAME", "TASK_FIELD_REWARD", "TASK_FIELD_LINK", "TASK_FIELD_DESC", "TASK_FIELD_CUSTOM_TIME",
      "TASK_EDIT_TITLE_", "TASK_EDIT_REWARD_", "TASK_EDIT_LINK_", "TASK_EDIT_CHANNEL_",
      "WAITING_TASK_ALERT_CHANNEL", "TASK_SEARCH",
      "WAITING_REDEEM_CODES", "WAITING_AMAZON_CODES",
      "LIVEFUND_WAIT_AMOUNT", "CH_EDIT_LINK_", "SL_EDIT_",
      "EDIT_WELCOME_TEXT", "EDIT_FOOTER_TEXT", "EDIT_START_TITLE", "EDIT_START_LINK_PREFIX", "EDIT_START_LINK_CLICKABLE", "EDIT_START_URL",
      "SUPPORT_SET", "GW_WAIT_NAME_V2", "GW_WAIT_URL_V2_", "GW_EDIT_URL_", "GW_MIN_", "GW_MAX_", "GW_TAX_",
      "ADD_CHANNEL_WAIT", "SET_PAYOUT_CHANNEL", "ADD_SOCIAL_LINK",
      "ADMWD_MIN_", "ADMWD_MAX_", "ADMWD_TAX_",
      "UADD_WAIT_", "UREM_WAIT_", "UMSG_WAIT_",
      "UNKNOWN_CMD_EDIT_TEXT", "KBC_EDIT_NAME_", "APC_EDIT_NAME_",
      "QP_WHITELIST_ADD", "QP_WHITELIST_REMOVE",
      "AUTO_UPI_SIMPLE_NAME", "AUTO_UPI_SIMPLE_URL_", "AUTO_UPI_ADVANCED_INPUT",
      "AUTO_UPI_EDIT_NAME_", "AUTO_UPI_EDIT_URL_", "AUTO_UPI_MIN_", "AUTO_UPI_MAX_", "AUTO_UPI_TAX_"
    ];

    let isAdminOnly = adminOnlyPrefixes.some(p => state === p || (p.endsWith("_") && state.startsWith(p)));
    if (!isAdminOnly) return false;

    if (state === "BROADCAST_WAIT_MSG") {
      let html = entitiesToHtml(text, ctx.message.entities || []);
      global.broadcastCache = global.broadcastCache || {};
      global.broadcastCache[userId] = { type: "text", content: html, mode: "direct", buttonRows: null, fromChatId: ctx.chat.id, fromMessageId: ctx.message.message_id };
      delete userState[userId];
      await renderBroadcastConfirm(ctx, global.broadcastCache[userId]);
      return true;
    }

    if (state === "BROADCAST_ADD_BUTTONS") {
      delete userState[userId];
      let cacheObj = global.broadcastCache?.[userId];
      if (!cacheObj) { await ctx.reply("❌ Session expired").catch(() => { }); return true; }
      let rows = parseInlineButtons(text);
      if (!rows || rows.length === 0) { await ctx.reply("❌ Invalid format!").catch(() => { }); return true; }
      cacheObj.buttonRows = rows;
      await renderBroadcastConfirm(ctx, cacheObj);
      return true;
    }

    if (state === "BROADCAST_TO_CHANNELS") {
      let html = entitiesToHtml(text, ctx.message.entities || []);
      let channels = await Channel.find({ isActive: true }).lean();
      let sent = 0, failed = 0;
      for (let ch of channels) {
        try { await bot.api.sendMessage(ch.channelId, html, { parse_mode: "HTML" }).catch(() => { throw new Error("x"); }); sent++; } catch (e) { failed++; }
      }
      delete userState[userId];
      await ctx.reply(`<b>${toSmallCaps("Broadcast Complete!")}</b>\n\n<blockquote>✅ Sent: ${sent}\n❌ Failed: ${failed}</blockquote>`, { parse_mode: "HTML" }).catch(() => { });
      return true;
    }

    if (state === "KBC_EDIT_NAME_") { /* fall through prefix */ }
    if (state.startsWith("KBC_EDIT_NAME_")) {
      let btnKey = state.replace("KBC_EDIT_NAME_", "");
      delete userState[userId];
      let layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
      let btn = layout.find(b => b.key === btnKey);
      if (btn) { btn.name = text; configCache.data["keyboard_layout"] = layout; await setConfig("keyboard_layout", layout); }
      await ctx.reply(`✅ Button name updated!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_keyboard_custom") }).catch(() => { });
      return true;
    }

    if (state.startsWith("APC_EDIT_NAME_")) {
      let btnKey = state.replace("APC_EDIT_NAME_", "");
      delete userState[userId];
      let layout = configCache.data["admin_panel_layout"] || DEFAULT_ADMIN_PANEL_LAYOUT;
      let btn = layout.find(b => b.key === btnKey);
      if (btn) { btn.name = text; configCache.data["admin_panel_layout"] = layout; await setConfig("admin_panel_layout", layout); }
      await ctx.reply(`✅ Button name updated!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_panel_custom") }).catch(() => { });
      return true;
    }

    if (state === "UNKNOWN_CMD_EDIT_TEXT") {
      delete userState[userId];
      await setConfig("unknown_command_text", text);
      await ctx.reply(`✅ Saved\n\nNew Text:\n${escapeHtml(text)}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_unknown_cmd") }).catch(() => { });
      return true;
    }

    if (state === "WAITING_ADMIN_ADD") {
      delete userState[userId];
      let input = text.trim();
      let targetUser = null;
      if (/^\d+$/.test(input)) targetUser = await User.findOne({ userId: parseInt(input, 10) });
      else {
        let cleanUsername = input.replace(/^@/, '').toLowerCase();
        targetUser = await User.findOne({ username: { $regex: new RegExp("^" + cleanUsername + "$", "i") } });
      }
      if (!targetUser) { await ctx.reply(`❌ User not found!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_permissions") }).catch(() => { }); return true; }
      await BotAdmin.findOneAndUpdate({ userId: targetUser.userId }, { addedAt: new Date(), addedBy: userId, isActive: true }, { upsert: true });
      await logAdminAction(userId, ctx.from.first_name || "Owner", "Admin Added", `${targetUser.userId}`, 0, targetUser.userId);
      await ctx.reply(`✅ <b>Admin added successfully!</b>\n\n👤 ${targetUser.firstName || "User"}\n🆔 <code>${targetUser.userId}</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_permissions") }).catch(() => { });
      try {
        await ctx.api.sendMessage(targetUser.userId, `🎉 <b>Congratulations!</b>\nYou are now Admin!\n\nUse /admin to open Admin Panel.`, { parse_mode: "HTML" }).catch(() => { });
      } catch (e) { }
      return true;
    }

    if (state === "WAITING_NEW_OWNER") {
      delete userState[userId];
      let newOwnerId = parseInt(text.trim(), 10);
      if (isNaN(newOwnerId)) { await ctx.reply(`❌ Invalid ID!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "admin") }).catch(() => { }); return true; }
      let targetUser = await User.findOne({ userId: newOwnerId });
      if (!targetUser) { await ctx.reply(`❌ User not found!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "admin") }).catch(() => { }); return true; }
      await ctx.reply(`⚠️ <b>Confirm Transfer?</b>\n\n👑 New Owner: ${targetUser.firstName || "User"}\n🆔 <code>${newOwnerId}</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Confirm ✅"), `admin_transfer_confirm_${newOwnerId}`).row().text(makeBtn("Cancel"), "admin") }).catch(() => { });
      return true;
    }

    if (state === "WAITING_TAX_PERCENT") {
      delete userState[userId];
      let amt = parseFloat(text);
      if (isNaN(amt) || amt < 0 || amt > 50) { await ctx.reply(`❌ Tax must be 0-50%!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_set_wd_tax") }).catch(() => { }); return true; }
      await setConfig("tax_percent", amt);
      await ctx.reply(`✅ Tax: ${amt}%`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_set_wd_tax") }).catch(() => { });
      return true;
    }

    if (state === "QP_SET_TAX") {
      delete userState[userId];
      let amt = parseFloat(text);
      if (isNaN(amt) || amt < 0 || amt > 50) { await ctx.reply(`❌ Tax must be 0-50%!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_quick_pay") }).catch(() => { }); return true; }
      await setConfig("quick_pay_tax_percent", amt);
      await ctx.reply(`✅ Quick Pay Tax: ${amt}%`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_quick_pay") }).catch(() => { });
      return true;
    }

    if (state === "QP_WHITELIST_ADD") {
      delete userState[userId];
      let targetId = parseInt(text.trim(), 10);
      if (isNaN(targetId)) { await ctx.reply(`❌ Invalid User ID!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "qp_whitelist") }).catch(() => { }); return true; }
      let targetUser = await User.findOne({ userId: targetId });
      if (!targetUser) { await ctx.reply(`❌ User not found! Ask them to /start first.`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "qp_whitelist") }).catch(() => { }); return true; }
      let whitelist = await getConfig("quick_pay_whitelist", []);
      if (!Array.isArray(whitelist)) whitelist = [];
      if (whitelist.includes(targetId)) { await ctx.reply(`⚠️ Already whitelisted!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "qp_whitelist") }).catch(() => { }); return true; }
      whitelist.push(targetId);
      await setConfig("quick_pay_whitelist", whitelist);
      await logAdminAction(userId, ctx.from.first_name || "Admin", "Whitelist Added", `${targetId}`, 0, targetId);
      await ctx.reply(`✅ User added to whitelist!\n\n👤 ${targetUser.firstName || "User"}\n🆔 <code>${targetId}</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "qp_whitelist") }).catch(() => { });
      return true;
    }

    if (state === "QP_WHITELIST_REMOVE") {
      delete userState[userId];
      let targetId = parseInt(text.trim(), 10);
      if (isNaN(targetId)) { await ctx.reply(`❌ Invalid User ID!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "qp_whitelist") }).catch(() => { }); return true; }
      let whitelist = await getConfig("quick_pay_whitelist", []);
      if (!Array.isArray(whitelist)) whitelist = [];
      let idx = whitelist.indexOf(targetId);
      if (idx === -1) { await ctx.reply(`⚠️ Not in whitelist!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "qp_whitelist") }).catch(() => { }); return true; }
      whitelist.splice(idx, 1);
      await setConfig("quick_pay_whitelist", whitelist);
      await ctx.reply(`✅ User removed from whitelist!\n\n🆔 <code>${targetId}</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "qp_whitelist") }).catch(() => { });
      return true;
    }

    if (state === "BAN_USER_WAIT") {
      delete userState[userId];
      let targetId = parseInt(text, 10);
      if (isNaN(targetId)) { await ctx.reply(`❌ Invalid!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_manage_ban") }).catch(() => { }); return true; }
      let targetUser = await User.findOne({ userId: targetId });
      if (!targetUser) { await ctx.reply(`❌ User not found!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_manage_ban") }).catch(() => { }); return true; }
      targetUser.isBanned = true;
      await targetUser.save();
      await logAdminAction(userId, ctx.from.first_name || "Admin", "User Banned", `${targetId}`, 0, targetId);
      try { await ctx.api.sendMessage(targetId, `🚫 ${toSmallCaps("You have been banned from using this bot.")}`, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
      await ctx.reply(`✅ User ${targetId} BANNED`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_manage_ban") }).catch(() => { });
      return true;
    }

    if (state === "UNBAN_USER_WAIT") {
      delete userState[userId];
      let targetId = parseInt(text, 10);
      if (isNaN(targetId)) { await ctx.reply(`❌ Invalid!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_manage_ban") }).catch(() => { }); return true; }
      let targetUser = await User.findOne({ userId: targetId });
      if (!targetUser) { await ctx.reply(`❌ User not found!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_manage_ban") }).catch(() => { }); return true; }
      targetUser.isBanned = false;
      await targetUser.save();
      await logAdminAction(userId, ctx.from.first_name || "Admin", "User Unbanned", `${targetId}`, 0, targetId);
      try { await ctx.api.sendMessage(targetId, `✅ ${toSmallCaps("You have been unbanned. Welcome back!")}`, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
      await ctx.reply(`✅ User ${targetId} UNBANNED`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_manage_ban") }).catch(() => { });
      return true;
    }

    if (state === "BAN_WALLET_WAIT") {
      delete userState[userId];
      await setConfig("banned_wallet", text);
      await ctx.reply(`✅ Wallet Banned: ${text}`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_manage_ban_wallet") }).catch(() => { });
      return true;
    }

    if (state === "WAITING_FOR_ADD_BAL") {
      delete userState[userId];
      let parts = text.trim().split(/\s+/).filter(p => p !== "");
      if (parts.length < 2) { await ctx.reply(`❌ Format: <code>UserID/@username Amount</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "admin") }).catch(() => { }); return true; }
      let input = parts[0].trim();
      let amount = parseFloat(parts[parts.length - 1]);
      if (isNaN(amount) || amount <= 0) { await ctx.reply(`❌ Invalid amount!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "admin") }).catch(() => { }); return true; }
      let targetUser = null;
      if (/^\d+$/.test(input)) targetUser = await User.findOne({ userId: parseInt(input, 10) });
      else { let cleanUsername = input.replace(/^@/, '').toLowerCase(); targetUser = await User.findOne({ username: { $regex: new RegExp("^" + cleanUsername + "$", "i") } }); }
      if (!targetUser) { await ctx.reply(`❌ User not found!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "admin") }).catch(() => { }); return true; }
      targetUser.balance += amount;
      await targetUser.save();
      await logBalanceHistory(targetUser.userId, "Admin Added Balance", amount);
      await logAdminAction(userId, ctx.from.first_name || "Admin", "Added Balance", `+₹${amount} to ${targetUser.userId}`, amount, targetUser.userId);
      try { await ctx.api.sendMessage(targetUser.userId, `💰 ${toSmallCaps("Admin Gave You A Increase In Balance By")} ${amount}`, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
      await ctx.reply(`💸 Admin Added ₹${amount.toFixed(2)}\n\n👤 User: ${targetUser.firstName || "User"} (<code>${targetUser.userId}</code>)\n💰 Now Balance: ${formatBalance(targetUser.balance)}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "admin") }).catch(() => { });
      return true;
    }

    if (state === "WAITING_FOR_REM_BAL") {
      delete userState[userId];
      let parts = text.trim().split(/\s+/).filter(p => p !== "");
      if (parts.length < 2) { await ctx.reply(`❌ Format: <code>UserID/@username Amount</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "admin") }).catch(() => { }); return true; }
      let input = parts[0].trim();
      let amount = parseFloat(parts[parts.length - 1]);
      if (isNaN(amount) || amount <= 0) { await ctx.reply(`❌ Invalid amount!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "admin") }).catch(() => { }); return true; }
      let targetUser = null;
      if (/^\d+$/.test(input)) targetUser = await User.findOne({ userId: parseInt(input, 10) });
      else { let cleanUsername = input.replace(/^@/, '').toLowerCase(); targetUser = await User.findOne({ username: { $regex: new RegExp("^" + cleanUsername + "$", "i") } }); }
      if (!targetUser) { await ctx.reply(`❌ User not found!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "admin") }).catch(() => { }); return true; }
      targetUser.balance -= amount;
      await targetUser.save();
      await logBalanceHistory(targetUser.userId, "Admin Removed Balance", -amount);
      await logAdminAction(userId, ctx.from.first_name || "Admin", "Removed Balance", `-₹${amount} from ${targetUser.userId}`, amount, targetUser.userId);
      try { await ctx.api.sendMessage(targetUser.userId, `💰 ${toSmallCaps("Admin Gave You A Decrease In Balance By")} ${amount}`, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
      await ctx.reply(`💸 Admin Removed ₹${amount.toFixed(2)}\n\n👤 User: ${targetUser.firstName || "User"} (<code>${targetUser.userId}</code>)\n💰 Now Balance: ${formatBalance(targetUser.balance)}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "admin") }).catch(() => { });
      return true;
    }

    if (state === "WAITING_FOR_TRACKER_ID") {
      delete userState[userId];
      let targetId = parseInt(text, 10);
      if (isNaN(targetId)) { await ctx.reply(`❌ Invalid!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "admin") }).catch(() => { }); return true; }
      let targetUser = await User.findOne({ userId: targetId });
      if (!targetUser) { await ctx.reply(`❌ User not found!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "admin") }).catch(() => { }); return true; }
      await ctx.reply(`👤 Loading user <code>${targetId}</code>...`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("View Details"), `user_detail_${targetId}`) }).catch(() => { });
      return true;
    }

    if (state === "WAITING_FOR_USER_MESSAGE") {
      delete userState[userId];
      let parts = text.split("|").map(p => p.trim());
      if (parts.length < 2) { await ctx.reply(`❌ Format: <code>UserID | Message</code>`, { parse_mode: "HTML" }).catch(() => { }); return true; }
      let targetId = parseInt(parts[0], 10);
      let message = parts.slice(1).join("|").trim();
      if (isNaN(targetId)) { await ctx.reply(`❌ Invalid User ID!`).catch(() => { }); return true; }
      try {
        await ctx.api.sendMessage(targetId, `📨 <b>${toSmallCaps("Admin Message")}</b>\n\n${message}`, { parse_mode: "HTML" }).catch(() => { });
        await ctx.reply(`✅ Sent to <code>${targetId}</code>!`, { parse_mode: "HTML" }).catch(() => { });
      } catch (e) { await ctx.reply(`❌ Failed: ${e.message}`).catch(() => { }); }
      return true;
    }

    if (state === "TASK_FIELD_NAME") {
      delete userState[userId];
      let temp = global.taskCreation?.[userId];
      if (!temp) { await ctx.reply(`❌ Session expired`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "task_create_start") }).catch(() => { }); return true; }
      temp.title = text.trim();
      await ctx.reply(`✅ Task Name: ${text.trim()}`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "task_create_start") }).catch(() => { });
      return true;
    }

    if (state === "TASK_FIELD_REWARD") {
      delete userState[userId];
      let amount = parseFloat(text);
      if (isNaN(amount) || amount <= 0) { await ctx.reply(`❌ Invalid amount!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "task_create_start") }).catch(() => { }); return true; }
      let temp = global.taskCreation?.[userId];
      if (!temp) { await ctx.reply(`❌ Session expired`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "task_create_start") }).catch(() => { }); return true; }
      temp.reward = amount;
      await ctx.reply(`✅ Reward: ₹${amount}`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "task_create_start") }).catch(() => { });
      return true;
    }

    if (state === "TASK_FIELD_LINK") {
      delete userState[userId];
      let link = text.trim();
      if (!link.startsWith("http")) { await ctx.reply(`❌ Invalid link!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "task_create_start") }).catch(() => { }); return true; }
      let temp = global.taskCreation?.[userId];
      if (!temp) { await ctx.reply(`❌ Session expired`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "task_create_start") }).catch(() => { }); return true; }
      temp.link = link;
      await ctx.reply(`✅ Link: ${link}`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "task_create_start") }).catch(() => { });
      return true;
    }

    if (state === "TASK_FIELD_DESC") {
      delete userState[userId];
      let temp = global.taskCreation?.[userId];
      if (!temp) { await ctx.reply(`❌ Session expired`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "task_create_start") }).catch(() => { }); return true; }
      temp.description = text.trim();
      await ctx.reply(`✅ Description: ${text.trim()}`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "task_create_start") }).catch(() => { });
      return true;
    }

    if (state === "TASK_FIELD_CUSTOM_TIME") {
      delete userState[userId];
      let minutes = parseInt(text.trim(), 10);
      if (isNaN(minutes) || minutes <= 0) { await ctx.reply(`❌ Invalid!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "task_create_start") }).catch(() => { }); return true; }
      let temp = global.taskCreation?.[userId];
      if (!temp) { await ctx.reply(`❌ Session expired`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "task_create_start") }).catch(() => { }); return true; }
      temp.expiryMinutes = minutes;
      await ctx.reply(`✅ Time Limit: ${formatMinutes(minutes)}`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "task_create_start") }).catch(() => { });
      return true;
    }

    if (state.startsWith("TASK_EDIT_TITLE_")) {
      let taskId = state.replace("TASK_EDIT_TITLE_", "");
      delete userState[userId];
      await Task.updateOne({ taskId }, { title: text });
      await ctx.reply(`✅ Title updated!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), `view_task_${taskId}`) }).catch(() => { });
      return true;
    }

    if (state.startsWith("TASK_EDIT_REWARD_")) {
      let taskId = state.replace("TASK_EDIT_REWARD_", "");
      delete userState[userId];
      let amt = parseFloat(text);
      if (isNaN(amt) || amt <= 0) { await ctx.reply(`❌ Invalid!`).catch(() => { }); return true; }
      await Task.updateOne({ taskId }, { reward: amt });
      await ctx.reply(`✅ Reward updated!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), `view_task_${taskId}`) }).catch(() => { });
      return true;
    }

    if (state.startsWith("TASK_EDIT_LINK_")) {
      let taskId = state.replace("TASK_EDIT_LINK_", "");
      delete userState[userId];
      await Task.updateOne({ taskId }, { link: text });
      await ctx.reply(`✅ Link updated!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), `view_task_${taskId}`) }).catch(() => { });
      return true;
    }

    if (state.startsWith("TASK_EDIT_CHANNEL_")) {
      let taskId = state.replace("TASK_EDIT_CHANNEL_", "");
      delete userState[userId];
      await Task.updateOne({ taskId }, { alertChannel: text });
      await ctx.reply(`✅ Alert Channel updated!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), `view_task_${taskId}`) }).catch(() => { });
      return true;
    }

    if (state === "WAITING_TASK_ALERT_CHANNEL") {
      delete userState[userId];
      let channelId = text.trim();
      if (!channelId.startsWith("@") && !/^-?\d+$/.test(channelId)) { await ctx.reply(`❌ Invalid Channel!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_tasks_manager") }).catch(() => { }); return true; }
      try {
        let chatInfo = await ctx.api.getChat(channelId);
        let botInfo = await ctx.api.getMe();
        let botMember = await ctx.api.getChatMember(channelId, botInfo.id);
        if (!["administrator", "creator"].includes(botMember.status)) { await ctx.reply(`❌ Bot must be admin in channel!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_tasks_manager") }).catch(() => { }); return true; }
      } catch (e) { await ctx.reply(`❌ Cannot access channel!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_tasks_manager") }).catch(() => { }); return true; }
      await setConfig("default_task_alert_channel", channelId);
      await ctx.reply(`✅ Task Alert Channel set!\n\n📢 <code>${channelId}</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_tasks_manager") }).catch(() => { });
      return true;
    }

    if (state === "TASK_SEARCH") {
      delete userState[userId];
      let query = text.trim();
      let task = await Task.findOne({ $or: [{ taskId: query }, { title: { $regex: new RegExp("^" + query + "$", "i") } }, { title: { $regex: new RegExp(query, "i") } }] }).lean();
      if (!task) { await ctx.reply(`❌ Task Not Found!`, { reply_markup: new InlineKeyboard().text(makeBtn("Try Again"), "adm_search_task").row().text(makeBtn("Back"), "adm_tasks_manager") }).catch(() => { }); return true; }
      let bodyText = `Task ID: ${task.taskId}\nName: ${task.title}\nReward: ₹${task.reward}\nLink: ${task.link}\nStatus: ${task.isActive !== false ? "🟢 ON" : "🔴 OFF"}`;
      let kb = new InlineKeyboard().text(makeBtn("View"), `view_task_${task.taskId}`).text(makeBtn("Delete"), `del_task_${task.taskId}`).row().text(makeBtn("Back"), "adm_tasks_manager");
      await ctx.reply(`<b>Task Found!</b>\n\n<blockquote>${bodyText}</blockquote>`, { parse_mode: "HTML", reply_markup: kb }).catch(() => { });
      return true;
    }

    if (state === "WAITING_REDEEM_CODES") {
      delete userState[userId];
      await saveCodes(text, "redeem", ctx);
      return true;
    }

    if (state === "WAITING_AMAZON_CODES") {
      delete userState[userId];
      await saveCodes(text, "amazon", ctx);
      return true;
    }

    if (state === "LIVEFUND_WAIT_AMOUNT") {
      delete userState[userId];
      let amt = parseFloat(text);
      if (isNaN(amt) || amt < 0) { await ctx.reply(`❌ Invalid amount!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "status_live_fund") }).catch(() => { }); return true; }
      await LiveFund.findOneAndUpdate({ key: "main_fund" }, { totalFund: amt, usedFund: 0, updatedAt: new Date() }, { upsert: true });
      await ctx.reply(`✅ Fund Set: ₹${amt}`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "status_live_fund") }).catch(() => { });
      return true;
    }

    if (state.startsWith("CH_EDIT_LINK_")) {
      let chId = state.replace("CH_EDIT_LINK_", "");
      delete userState[userId];
      let newLink = text.trim();
      if (!newLink.startsWith("http")) { await ctx.reply(`❌ Invalid link!`).catch(() => { }); return true; }
      await Channel.updateOne({ channelId: chId }, { inviteLink: newLink });
      await ctx.reply(`✅ Updated!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_manage_channels") }).catch(() => { });
      return true;
    }

    if (state.startsWith("SL_EDIT_")) {
      let id = state.replace("SL_EDIT_", "");
      delete userState[userId];
      let parts = text.split("|").map(p => p.trim());
      if (parts.length !== 2) { await ctx.reply(`❌ Format: <code>Name | Link</code>`, { parse_mode: "HTML" }).catch(() => { }); return true; }
      await SocialLink.findByIdAndUpdate(id, { name: parts[0], link: parts[1] });
      await ctx.reply(`✅ Updated!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_manage_channels") }).catch(() => { });
      return true;
    }

    if (state === "EDIT_WELCOME_TEXT") {
      delete userState[userId];
      let html = entitiesToHtml(text, ctx.message.entities || []);
      await setConfig("balance_welcome_text", html);
      await ctx.reply(`✅ Welcome Message Updated!\n\n${html}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_edit_balance_text") }).catch(() => { });
      return true;
    }

    if (state === "EDIT_FOOTER_TEXT") {
      delete userState[userId];
      let html = entitiesToHtml(text, ctx.message.entities || []);
      await setConfig("balance_footer_text", html);
      await ctx.reply(`✅ Footer Updated!\n\n❝ ${html} ❞`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_edit_balance_text") }).catch(() => { });
      return true;
    }

    if (state === "EDIT_START_TITLE") {
      delete userState[userId];
      let html = entitiesToHtml(text, ctx.message.entities || []);
      await setConfig("start_title_text", html);
      await ctx.reply(`✅ Title Updated!\n\n${html}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_start_edit") }).catch(() => { });
      return true;
    }

    if (state === "EDIT_START_LINK_PREFIX") {
      delete userState[userId];
      let html = entitiesToHtml(text, ctx.message.entities || []);
      await setConfig("start_link_prefix", html);
      await ctx.reply(`✅ Link Prefix Updated!`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_start_edit") }).catch(() => { });
      return true;
    }

    if (state === "EDIT_START_LINK_CLICKABLE") {
      delete userState[userId];
      let html = entitiesToHtml(text, ctx.message.entities || []);
      await setConfig("start_link_clickable", html);
      await ctx.reply(`✅ Clickable Text Updated!`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_start_edit") }).catch(() => { });
      return true;
    }

    if (state === "EDIT_START_URL") {
      delete userState[userId];
      let input = text.trim();
      if (!input) { await ctx.reply(`❌ Invalid!`).catch(() => { }); return true; }
      await setConfig("welcome_channel_link", input);
      let link = convertOwnerLink(input);
      await ctx.reply(`✅ Link URL Updated!\n\n🔗 ${link}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_start_edit") }).catch(() => { });
      return true;
    }

    if (state === "SUPPORT_SET") {
      delete userState[userId];
      let input = text.trim();
      if (!isValidTelegramID(input)) { await ctx.reply(`❌ INVALID INPUT!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_support") }).catch(() => { }); return true; }
      await setConfig("support_username", input);
      let link = convertOwnerLink(input);
      await ctx.reply(`✅ Customer Support Set!\n\n🔗 ${link}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_support") }).catch(() => { });
      return true;
    }

    if (state === "GW_WAIT_NAME_V2") {
      let gwName = text.toUpperCase().replace(/\s+/g, "_");
      if (gwName.length < 2) { await ctx.reply(`❌ Name too short!`).catch(() => { }); return true; }
      let existing = await Gateway.findOne({ name: gwName });
      if (existing) { delete userState[userId]; await ctx.reply(`❌ Gateway already exists!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_gateway_list") }).catch(() => { }); return true; }
      userState[userId] = `GW_WAIT_URL_V2_${gwName}`;
      await ctx.reply(`✅ Name: <b>${gwName}</b>\n\n🔗 Paste Your Gateway URL:`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_gateway_list") }).catch(() => { });
      return true;
    }

    if (state.startsWith("GW_WAIT_URL_V2_")) {
      let gwName = state.replace("GW_WAIT_URL_V2_", "");
      if (!text.startsWith("http://") && !text.startsWith("https://")) { await ctx.reply(`❌ URL must start with http`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_gateway_list") }).catch(() => { }); return true; }
      delete userState[userId];
      await Gateway.create({ name: gwName, url: text.trim(), url_template: text.trim(), isActive: true, minAmount: 0, maxAmount: 0, taxPercent: 0, createdBy: userId });
      await logAdminAction(userId, ctx.from.first_name || "Admin", "Gateway Added", gwName, 0, null);
      await ctx.reply(`✅ Gateway Created!\n\n📛 ${gwName}\n🟢 ON`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_gateway_list") }).catch(() => { });
      return true;
    }

    if (state.startsWith("GW_EDIT_URL_")) {
      let gwName = state.replace("GW_EDIT_URL_", "");
      delete userState[userId];
      if (!text.startsWith("http")) { await ctx.reply(`❌ Invalid URL!`).catch(() => { }); return true; }
      await Gateway.findOneAndUpdate({ name: gwName }, { url: text.trim(), url_template: text.trim(), updatedAt: new Date() });
      await ctx.reply(`✅ Gateway Updated!`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), `gw_view_${gwName}`) }).catch(() => { });
      return true;
    }

    if (state.startsWith("GW_MIN_")) {
      let gwName = state.replace("GW_MIN_", "");
      delete userState[userId];
      let amt = parseFloat(text);
      if (isNaN(amt) || amt < 0) { await ctx.reply(`❌ Invalid!`).catch(() => { }); return true; }
      await Gateway.updateOne({ name: gwName }, { minAmount: amt, updatedAt: new Date() });
      await ctx.reply(`✅ Min: ₹${amt}`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), `gw_edit_${gwName}`) }).catch(() => { });
      return true;
    }

    if (state.startsWith("GW_MAX_")) {
      let gwName = state.replace("GW_MAX_", "");
      delete userState[userId];
      let amt = parseFloat(text);
      if (isNaN(amt) || amt < 0) { await ctx.reply(`❌ Invalid!`).catch(() => { }); return true; }
      await Gateway.updateOne({ name: gwName }, { maxAmount: amt, updatedAt: new Date() });
      await ctx.reply(`✅ Max: ₹${amt}`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), `gw_edit_${gwName}`) }).catch(() => { });
      return true;
    }

    if (state.startsWith("GW_TAX_")) {
      let gwName = state.replace("GW_TAX_", "");
      delete userState[userId];
      let amt = parseFloat(text);
      if (isNaN(amt) || amt < 0 || amt > 50) { await ctx.reply(`❌ Tax must be 0-50%!`).catch(() => { }); return true; }
      await Gateway.updateOne({ name: gwName }, { taxPercent: amt, updatedAt: new Date() });
      await ctx.reply(`✅ Tax: ${amt}%`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), `gw_edit_${gwName}`) }).catch(() => { });
      return true;
    }

    if (state === "ADD_CHANNEL_WAIT") {
      delete userState[userId];
      let channelId = text.trim();
      if (!channelId.startsWith("@") && !/^-?\d+$/.test(channelId)) { await ctx.reply(`❌ Invalid Channel ID!`).catch(() => { }); return true; }
      let existing = await Channel.findOne({ channelId });
      if (existing) { await ctx.reply(`❌ Channel already added!`).catch(() => { }); return true; }
      try {
        let chatInfo = await ctx.api.getChat(channelId);
        let botInfo = await ctx.api.getMe();
        let botMember = await ctx.api.getChatMember(channelId, botInfo.id);
        if (!["administrator", "creator"].includes(botMember.status)) { await ctx.reply(`❌ Bot must be admin in channel!`).catch(() => { }); return true; }
        let inviteLink = "";
        try {
          if (chatInfo.invite_link) inviteLink = chatInfo.invite_link;
          else { let link = await ctx.api.createChatInviteLink(channelId, { name: "Auto", creates_join_request: false }); inviteLink = link.invite_link; }
        } catch (e) { }
        let maxOrder = await Channel.findOne({}).sort({ order: -1 }).lean();
        let newOrder = (maxOrder?.order || 0) + 1;
        await Channel.create({ channelId, inviteLink: inviteLink || `https://t.me/${channelId.replace("@", "")}`, displayName: chatInfo.title || channelId, isActive: true, isHidden: false, order: newOrder });
        await logAdminAction(userId, ctx.from.first_name || "Admin", "Channel Added", channelId, 0, null);
        await ctx.reply(`✅ Added Successfully!\n\n📢 ${chatInfo.title || channelId}`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_manage_channels") }).catch(() => { });
      } catch (e) { await ctx.reply(`❌ Cannot access channel! ${e.message}`).catch(() => { }); return true; }
      return true;
    }

    if (state === "SET_PAYOUT_CHANNEL") {
      delete userState[userId];
      let channelId = text.trim();
      if (!channelId.startsWith("@") && !/^-?\d+$/.test(channelId)) { await ctx.reply(`❌ Invalid!`).catch(() => { }); return true; }
      try {
        let chatInfo = await ctx.api.getChat(channelId);
        let botInfo = await ctx.api.getMe();
        let botMember = await ctx.api.getChatMember(channelId, botInfo.id);
        if (!["administrator", "creator"].includes(botMember.status)) { await ctx.reply(`❌ Bot must be admin!`).catch(() => { }); return true; }
      } catch (e) { await ctx.reply(`❌ Cannot access: ${e.message}`).catch(() => { }); return true; }
      await setConfig("payout_channel", channelId);
      await logAdminAction(userId, ctx.from.first_name || "Admin", "Set Payout Channel", channelId, 0, null);
      await ctx.reply(`✅ Successfully Set!\n\n📢 Payout Channel:\n<code>${channelId}</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_manage_channels") }).catch(() => { });
      return true;
    }

    if (state === "ADD_SOCIAL_LINK") {
      delete userState[userId];
      let parts = text.split("|").map(p => p.trim());
      if (parts.length !== 2) { await ctx.reply(`❌ Format: <code>Name | Link</code>`, { parse_mode: "HTML" }).catch(() => { }); return true; }
      await SocialLink.create({ name: parts[0], link: parts[1] });
      await logAdminAction(userId, ctx.from.first_name || "Admin", "Social Link Added", parts[0], 0, null);
      await ctx.reply(`✅ Added!\n\n🔗 ${parts[0]}`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), "adm_manage_channels") }).catch(() => { });
      return true;
    }

    if (state.startsWith("ADMWD_MIN_")) {
      let method = state.replace("ADMWD_MIN_", "");
      delete userState[userId];
      let amt = parseFloat(text);
      if (isNaN(amt) || amt < 0) { await ctx.reply(`❌ Invalid!`).catch(() => { }); return true; }
      let s = await WithdrawSettings.findOne({ method });
      if (!s) s = await WithdrawSettings.create({ method, isActive: false });
      s.minAmount = amt; s.updatedAt = new Date(); await s.save();
      await ctx.reply(`✅ Min: ₹${amt}`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), `admwd_edit_${method}`) }).catch(() => { });
      return true;
    }

    if (state.startsWith("ADMWD_MAX_")) {
      let method = state.replace("ADMWD_MAX_", "");
      delete userState[userId];
      let amt = parseFloat(text);
      if (isNaN(amt) || amt < 0) { await ctx.reply(`❌ Invalid!`).catch(() => { }); return true; }
      let s = await WithdrawSettings.findOne({ method });
      if (!s) s = await WithdrawSettings.create({ method, isActive: false });
      s.maxAmount = amt; s.updatedAt = new Date(); await s.save();
      await ctx.reply(`✅ Max: ₹${amt}`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), `admwd_edit_${method}`) }).catch(() => { });
      return true;
    }

    if (state.startsWith("ADMWD_TAX_")) {
      let method = state.replace("ADMWD_TAX_", "");
      delete userState[userId];
      let amt = parseFloat(text);
      if (isNaN(amt) || amt < 0 || amt > 50) { await ctx.reply(`❌ Tax must be 0-50%!`).catch(() => { }); return true; }
      let s = await WithdrawSettings.findOne({ method });
      if (!s) s = await WithdrawSettings.create({ method, isActive: false });
      s.taxPercent = amt; s.updatedAt = new Date(); await s.save();
      await ctx.reply(`✅ Tax: ${amt}%`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), `admwd_edit_${method}`) }).catch(() => { });
      return true;
    }

    if (state.startsWith("UADD_WAIT_")) {
      let targetId = parseInt(state.replace("UADD_WAIT_", ""), 10);
      delete userState[userId];
      let amount = parseFloat(text);
      if (isNaN(amount) || amount <= 0) { await ctx.reply(`❌ Invalid!`).catch(() => { }); return true; }
      let targetUser = await User.findOne({ userId: targetId });
      if (!targetUser) { await ctx.reply(`❌ User not found!`).catch(() => { }); return true; }
      targetUser.balance += amount;
      await targetUser.save();
      await logBalanceHistory(targetId, "Admin Added Balance", amount);
      await logAdminAction(userId, ctx.from.first_name || "Admin", "Added Balance", `+₹${amount}`, amount, targetId);
      try { await ctx.api.sendMessage(targetId, `💰 ${toSmallCaps("Admin Gave You A Increase In Balance By")} ${amount}`, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
      await ctx.reply(`✅ Added ₹${amount}. New: ${formatBalance(targetUser.balance)}`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), `user_detail_${targetId}`) }).catch(() => { });
      return true;
    }

    if (state.startsWith("UREM_WAIT_")) {
      let targetId = parseInt(state.replace("UREM_WAIT_", ""), 10);
      delete userState[userId];
      let amount = parseFloat(text);
      if (isNaN(amount) || amount <= 0) { await ctx.reply(`❌ Invalid!`).catch(() => { }); return true; }
      let targetUser = await User.findOne({ userId: targetId });
      if (!targetUser) { await ctx.reply(`❌ User not found!`).catch(() => { }); return true; }
      targetUser.balance -= amount;
      await targetUser.save();
      await logBalanceHistory(targetId, "Admin Removed Balance", -amount);
      await logAdminAction(userId, ctx.from.first_name || "Admin", "Removed Balance", `-₹${amount}`, amount, targetId);
      try { await ctx.api.sendMessage(targetId, `💰 ${toSmallCaps("Admin Gave You A Decrease In Balance By")} ${amount}`, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
      await ctx.reply(`✅ Removed ₹${amount}. New: ${formatBalance(targetUser.balance)}`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), `user_detail_${targetId}`) }).catch(() => { });
      return true;
    }

    if (state.startsWith("UMSG_WAIT_")) {
      let targetId = parseInt(state.replace("UMSG_WAIT_", ""), 10);
      delete userState[userId];
      try {
        await ctx.api.sendMessage(targetId, `📨 <b>${toSmallCaps("Message from Admin")}</b>\n\n${text}`, { parse_mode: "HTML" }).catch(() => { });
        await ctx.reply(`✅ Sent to ${targetId}`, { reply_markup: new InlineKeyboard().text(makeBtn("Back"), `user_detail_${targetId}`) }).catch(() => { });
      } catch (e) { await ctx.reply(`❌ Failed: ${e.message}`).catch(() => { }); }
      return true;
    }

    if (state === "AUTO_UPI_SIMPLE_NAME") {
      let name = text.trim().toUpperCase();
      if (name.length < 2) { await ctx.reply(`❌ Name too short (min 2 chars)!`).catch(() => { }); return true; }
      let existing = await AutoUpi.findOne({ name });
      if (existing) { await ctx.reply(`❌ Auto UPI "${name}" already exists!`).catch(() => { }); return true; }
      userState[userId] = `AUTO_UPI_SIMPLE_URL_${name}`;
      await ctx.reply(`📝 <b>Simple Model</b>\n\n✅ Name: <b>${name}</b>\n\nStep 2 of 2\n\n📝 Send API URL:\n\nExample:\n<code>https://api.cashfree.com/payout</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("Cancel", "adm_auto_upi") }).catch(() => { });
      return true;
    }

    if (state.startsWith("AUTO_UPI_SIMPLE_URL_")) {
      let name = state.replace("AUTO_UPI_SIMPLE_URL_", "");
      delete userState[userId];
      let url = text.trim();
      if (!url.startsWith("http")) { await ctx.reply(`❌ Invalid URL! Must start with http`).catch(() => { }); return true; }
      let gwId = "AUTO" + Date.now().toString().slice(-8);
      await AutoUpi.create({ gatewayId: gwId, name, apiUrl: url, method: "GET", status: "active", minAmount: 0, maxAmount: 0, taxPercent: 0 });
      await logAdminAction(userId, ctx.from.first_name || "Admin", "Auto UPI Added (Simple)", name, 0, null);
      await ctx.reply(`✅ <b>Auto UPI Added!</b>\n\n🌐 ${name}\n🟢 ON\nMethod: GET\n\nURL:\n<code>${url}</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("View", `auto_upi_view_${gwId}`).row().text("Back", "adm_auto_upi") }).catch(() => { });
      return true;
    }

    if (state === "AUTO_UPI_ADVANCED_INPUT") {
      delete userState[userId];
      let parts = text.trim().split("::").map(p => p.trim());
      let name, method, url;
      if (parts.length === 3) { name = parts[0].toUpperCase(); method = parts[1].toUpperCase(); url = parts[2]; }
      else if (parts.length === 2) { name = parts[0].toUpperCase(); method = "GET"; url = parts[1]; }
      else { await ctx.reply(`❌ Invalid format! Use: NAME::METHOD::URL`).catch(() => { }); return true; }
      if (!name || name.length < 2) { await ctx.reply(`❌ Name too short!`).catch(() => { }); return true; }
      if (!["GET", "POST"].includes(method)) method = "GET";
      if (!url.startsWith("http")) { await ctx.reply(`❌ Invalid URL!`).catch(() => { }); return true; }
      let existing = await AutoUpi.findOne({ name });
      if (existing) { await ctx.reply(`❌ Already exists!`).catch(() => { }); return true; }
      let gwId = "AUTO" + Date.now().toString().slice(-8);
      await AutoUpi.create({ gatewayId: gwId, name, apiUrl: url, method, status: "active", minAmount: 0, maxAmount: 0, taxPercent: 0 });
      await logAdminAction(userId, ctx.from.first_name || "Admin", "Auto UPI Added (Advanced)", name, 0, null);
      await ctx.reply(`✅ <b>Auto UPI Added!</b>\n\n🌐 ${name}\n🟢 ON\nMethod: ${method}\n\nURL:\n<code>${url}</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("View", `auto_upi_view_${gwId}`).row().text("Back", "adm_auto_upi") }).catch(() => { });
      return true;
    }

    if (state.startsWith("AUTO_UPI_EDIT_NAME_")) {
      let gwId = state.replace("AUTO_UPI_EDIT_NAME_", "");
      delete userState[userId];
      let name = text.trim().toUpperCase();
      if (name.length < 2) { await ctx.reply(`❌ Too short!`).catch(() => { }); return true; }
      await AutoUpi.updateOne({ gatewayId: gwId }, { name });
      await ctx.reply(`✅ Name updated: ${name}`, { reply_markup: new InlineKeyboard().text("Back", `auto_upi_view_${gwId}`) }).catch(() => { });
      return true;
    }

    if (state.startsWith("AUTO_UPI_EDIT_URL_")) {
      let gwId = state.replace("AUTO_UPI_EDIT_URL_", "");
      delete userState[userId];
      let url = text.trim();
      if (!url.startsWith("http")) { await ctx.reply(`❌ Invalid URL!`).catch(() => { }); return true; }
      await AutoUpi.updateOne({ gatewayId: gwId }, { apiUrl: url });
      await ctx.reply(`✅ URL updated`, { reply_markup: new InlineKeyboard().text("Back", `auto_upi_view_${gwId}`) }).catch(() => { });
      return true;
    }

    if (state.startsWith("AUTO_UPI_MIN_")) {
      let gwId = state.replace("AUTO_UPI_MIN_", "");
      delete userState[userId];
      let amt = parseFloat(text);
      if (isNaN(amt) || amt < 0) { await ctx.reply(`❌ Invalid!`).catch(() => { }); return true; }
      await AutoUpi.updateOne({ gatewayId: gwId }, { minAmount: amt });
      await ctx.reply(`✅ Min: ₹${amt}`, { reply_markup: new InlineKeyboard().text("Back", `auto_upi_edit_${gwId}`) }).catch(() => { });
      return true;
    }

    if (state.startsWith("AUTO_UPI_MAX_")) {
      let gwId = state.replace("AUTO_UPI_MAX_", "");
      delete userState[userId];
      let amt = parseFloat(text);
      if (isNaN(amt) || amt < 0) { await ctx.reply(`❌ Invalid!`).catch(() => { }); return true; }
      await AutoUpi.updateOne({ gatewayId: gwId }, { maxAmount: amt });
      await ctx.reply(`✅ Max: ₹${amt}`, { reply_markup: new InlineKeyboard().text("Back", `auto_upi_edit_${gwId}`) }).catch(() => { });
      return true;
    }

    if (state.startsWith("AUTO_UPI_TAX_")) {
      let gwId = state.replace("AUTO_UPI_TAX_", "");
      delete userState[userId];
      let amt = parseFloat(text);
      if (isNaN(amt) || amt < 0 || amt > 50) { await ctx.reply(`❌ 0-50%!`).catch(() => { }); return true; }
      await AutoUpi.updateOne({ gatewayId: gwId }, { taxPercent: amt });
      await ctx.reply(`✅ Tax: ${amt}%`, { reply_markup: new InlineKeyboard().text("Back", `auto_upi_edit_${gwId}`) }).catch(() => { });
      return true;
    }

    return true;
  } catch (e) {
    console.error("handleAdminTextInput error:", e.message);
    return true;
  }
}

// ==================== BOT ERROR HANDLER ====================
bot.catch((err) => console.error("❌ Bot Error:", err.message));

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

    let savedLayoutVersion = await getConfig("layout_version", "v1");
    if (savedLayoutVersion !== CURRENT_LAYOUT_VERSION) {
      console.log(`🔄 Layout version changed (${savedLayoutVersion} → ${CURRENT_LAYOUT_VERSION}), resetting...`);
      await setConfig("admin_panel_layout", DEFAULT_ADMIN_PANEL_LAYOUT);
      await setConfig("keyboard_layout", DEFAULT_KEYBOARD_LAYOUT);
      await setConfig("layout_version", CURRENT_LAYOUT_VERSION);
      console.log(`✅ Layouts reset to code defaults`);
    }

    let fund = await LiveFund.findOne({ key: "main_fund" });
    if (!fund) await LiveFund.create({ key: "main_fund" });

    let wsCount = await WithdrawSettings.countDocuments({});
    if (wsCount === 0) {
      const defaults = [
        { method: "upi", isActive: true, minAmount: 0, maxAmount: 0, taxPercent: 0 },
        { method: "bank", isActive: true, minAmount: 0, maxAmount: 0, taxPercent: 0 },
        { method: "amazon", isActive: false, minAmount: 0, maxAmount: 0, taxPercent: 0 },
        { method: "redeem", isActive: false, minAmount: 0, maxAmount: 0, taxPercent: 0 }
      ];
      for (let d of defaults) await WithdrawSettings.create(d);
    }

    setInterval(async () => {
      try {
        let now = new Date();
        let expiredTasks = await Task.find({ expiresAt: { $ne: null, $lte: now }, isComplete: true });
        for (let task of expiredTasks) { await Task.deleteOne({ taskId: task.taskId }); console.log(`⏰ Expired task deleted: ${task.taskId}`); }
      } catch (e) { }
    }, 60 * 1000);

    console.log("⏳ Waiting 8s for cleanup...");
    await new Promise(r => setTimeout(r, 8000));
    console.log("🌐 Server ready");
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

// ==========================================
// ✅ AUTO UPI UNIVERSAL SUPPORT (Ravi Wallet & Others)
// ==========================================

const originalProcessAutoUpiPayout = processAutoUpiPayout;
processAutoUpiPayout = async function({ bot, userId, amount, gateway, upiId }) {
  try {
    let ref = "AUTO" + Date.now();
    let apiUrl = gateway.apiUrl || "";
    let method = (gateway.method || "GET").toUpperCase();
    let token = gateway.apiKey || "";
    let finalUrl = apiUrl;
    
    if (finalUrl.includes("{upi_id}") || finalUrl.includes("{upi}") || finalUrl.includes("{amount}")) {
        finalUrl = finalUrl
            .replace(/{upi_id}/g, encodeURIComponent(upiId))
            .replace(/{upi}/g, encodeURIComponent(upiId))
            .replace(/{amount}/g, amount)
            .replace(/{token}/g, token);
        if (token && !finalUrl.includes("token=") && !finalUrl.includes(token)) {
            let separator = finalUrl.includes("?") ? "&" : "?";
            finalUrl += `${separator}token=${encodeURIComponent(token)}`;
        }
    } else {
        let separator = apiUrl.includes("?") ? "&" : "?";
        let tokenParam = token ? `token=${encodeURIComponent(token)}&` : "";
        finalUrl = `${apiUrl}${separator}${tokenParam}upi=${encodeURIComponent(upiId)}&amount=${amount}&order_id=${ref}`;
    }

    let response;
    let resData;
    try {
      response = await axios({ method: method, url: finalUrl, timeout: 30000 });
      try { resData = JSON.stringify(response.data); }
      catch (e) { resData = String(response.data); }
    } catch (apiErr) {
      let errorMsg = apiErr.response?.data?.message || apiErr.message || 'Auto UPI request failed';
      return { status: 'error', message: errorMsg };
    }

    let isSuccess = false;
    let txnId = null;
    try {
      let data = response.data;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { } }
      if (data && typeof data === 'object') {
        isSuccess = data.status === 'success' || data.status === 'Success' || data.success === true;
        txnId = data.txn_id || data.transaction_id || data.order_id || null;
      }
    } catch (parseErr) { }

    if (!isSuccess) {
      let errMsg = response.data?.message || 'Gateway declined';
      return { status: 'failed', message: errMsg, rawResponse: resData ? resData.substring(0, 300) : '' };
    }

    let user = await User.findOne({ userId });
    if (!user) return { status: 'error', message: 'User not found' };

    let newBalance = user.balance;
    let botUsername = bot.botInfo ? bot.botInfo.username : "Bot";
    let maskedUPI = halfMaskUPI(upiId);

    let msg = `✅ <b>New Auto UPI Withdrawal</b> ✅\n\n` +
              `🟢 <b>User :</b> <b>${userId}</b>\n` +
              `🤘 <b>Remaining Balance :-</b> ₹<code>${newBalance.toFixed(2)}</code>\n\n` +
              `🚀 <b>Amount :</b> ₹<b><code>${amount}</code></b> INR (-)\n` +
              `🏦 <b>UPI :</b> <b><code>${maskedUPI}</code></b>\n` +
              `🌐 <b>Gateway :</b> ${gateway.name}\n\n` +
              `💡 <b>Bot:</b> @${botUsername}\n\n` +
              `⚠️ <b>${gateway.name} Response:</b>\n<code>${resData}</code>`;

    let payoutChannel = await getPayoutChannel("auto_upi");
    if (payoutChannel && payoutChannel !== "Not Set") {
      try { await bot.api.sendMessage(payoutChannel, msg, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
    }

    return { status: 'success', txnNumber: txnId || generateTxnNumber(), rawResponse: resData };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
};

const originalHandleAdminTextInput = handleAdminTextInput;
handleAdminTextInput = async function(ctx, text, userId, state) {
    if (state === "AUTO_UPI_ADVANCED_INPUT") {
        delete userState[userId];
        let parts = text.trim().split("::").map(p => p.trim());
        let name, method, url, apiKey = "", apiSecret = "";
        
        if (parts.length === 4) { 
            name = parts[0].toUpperCase(); 
            method = parts[1].toUpperCase(); 
            url = parts[2]; 
            apiKey = parts[3]; 
        }
        else if (parts.length === 3) { 
            name = parts[0].toUpperCase(); 
            method = parts[1].toUpperCase(); 
            url = parts[2]; 
        }
        else if (parts.length === 2) { 
            name = parts[0].toUpperCase(); 
            method = "GET"; 
            url = parts[1]; 
        }
        else { 
            await ctx.reply(`❌ Invalid format!\nUse: <code>NAME::METHOD::URL::TOKEN</code>`, {parse_mode: "HTML"}).catch(() => { }); 
            return true; 
        }
        
        if (!name || name.length < 2) { await ctx.reply(`❌ Name too short!`).catch(() => { }); return true; }
        if (!["GET", "POST"].includes(method)) method = "GET";
        if (!url.startsWith("http")) { await ctx.reply(`❌ Invalid URL!`).catch(() => { }); return true; }
        
        let existing = await AutoUpi.findOne({ name });
        if (existing) { await ctx.reply(`❌ Already exists!`).catch(() => { }); return true; }
        
        let gwId = "AUTO" + Date.now().toString().slice(-8);
        
        await AutoUpi.create({ 
            gatewayId: gwId, name, apiUrl: url, method, apiKey, apiSecret, 
            status: "active", minAmount: 0, maxAmount: 0, taxPercent: 0 
        });
        
        await logAdminAction(userId, ctx.from.first_name || "Admin", "Auto UPI Added (Advanced)", name, 0, null);
        await ctx.reply(
            `✅ <b>Auto UPI Added!</b>\n\n🌐 ${name}\n🟢 ON\nMethod: ${method}\n${apiKey ? `🔑 Token/Key: <code>${apiKey.substring(0, 8)}...</code>\n` : ""}\nURL:\n<code>${url}</code>`, 
            { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("View", `auto_upi_view_${gwId}`).row().text("Back", "adm_auto_upi") }
        ).catch(() => { });
        return true;
    }
    
    return await originalHandleAdminTextInput(ctx, text, userId, state);
};

// ==========================================
// ✅ UNIVERSAL GATEWAY & AUTO BANK GATEWAY SUPPORT (FIXED)
// ==========================================

// 1. NORMAL GATEWAY UNIVERSAL PATCH (VSV Support)
const originalProcessGatewayPayout = processGatewayPayout;
processGatewayPayout = async function({ bot, userId, amount, gatewayInfo, wallet, channelList = [], showRemainingBalance = true }) {
  try {
    let urlTemplate = gatewayInfo.url_template || gatewayInfo.url || "";
    
    let finalUrl = urlTemplate
      .replace(/{wallet}/g, encodeURIComponent(wallet))
      .replace(/{number}/g, encodeURIComponent(wallet))
      .replace(/{paytm}/g, encodeURIComponent(wallet))
      .replace(/{amount}/g, encodeURIComponent(amount))
      .replace(/{userId}/g, encodeURIComponent(userId))
      .replace(/{orderId}/g, encodeURIComponent("WD" + Date.now()))
      .replace(/{order_id}/g, encodeURIComponent("WD" + Date.now()))
      .replace(/{comment}/g, encodeURIComponent("WD" + Date.now()))
      .replace(/{txnId}/g, encodeURIComponent("TXN" + Date.now()))
      .replace(/{timestamp}/g, encodeURIComponent(Date.now()));

    let response, resData;
    try {
      response = await axios.get(finalUrl, { timeout: 30000 });
      try { resData = JSON.stringify(response.data); } catch (e) { resData = String(response.data); }
    } catch (apiErr) {
      return { status: 'error', message: apiErr.response?.data?.message || apiErr.message || 'Gateway request failed' };
    }

    let isSuccess = false;
    let txnNumber = null;
    try {
      let data = response.data;
      let jsonData = null;
      if (typeof data === 'string') { try { jsonData = JSON.parse(data); } catch (e) { } } 
      else if (data && typeof data === 'object') { jsonData = data; }

      if (jsonData) {
        isSuccess = jsonData.status === 'success' || jsonData.status === 'Success' || jsonData.success === true || jsonData.code === 200 || jsonData.status === 'ok';
        txnNumber = jsonData.txn_id || jsonData.txnNumber || jsonData.transaction_id || jsonData.txnId || jsonData.orderId || null;
      }
      if (!isSuccess && resData) {
        if (/failed|error|declined|invalid|insufficient/i.test(resData)) isSuccess = false;
        else if (/success|completed|done|paid|processed|ok/i.test(resData)) isSuccess = true;
      }
    } catch (parseErr) { }

    if (!isSuccess) {
      let errMsg = 'Gateway declined';
      if (response.data && response.data.message) errMsg = response.data.message;
      else if (resData && resData.length < 100) errMsg = resData;
      return { status: 'failed', message: errMsg, rawResponse: resData ? resData.substring(0, 300) : '' };
    }

    let user = await User.findOne({ userId });
    if (!user) return { status: 'error', message: 'User not found' };

    let maskedWallet = halfMaskWallet(wallet);
    let msg = `✅ <b>New Withdrawal Processed</b> ✅\n\n🟢 <b>User :</b> <b>${userId}</b>\n`;
    if (showRemainingBalance) msg += `🤘 <b>Remaining Balance :-</b> ₹<code>${user.balance.toFixed(2)}</code>\n`;
    msg += `\n🚀 <b>Amount :</b> ₹<b><code>${amount}</code></b> INR (-)\n⛔ <b>Address :</b> <b><code>${maskedWallet}</code></b>\n\n💡 <b>Bot:</b> @${bot.botInfo ? bot.botInfo.username : "Bot"}\n\n⚠️ <b>${gatewayInfo.name} Response:</b>\n<code>${resData}</code>`;

    for (let ch of channelList) {
      if (ch) try { await bot.api.sendMessage(ch, msg, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
    }
    return { status: 'success', txnNumber: txnNumber || generateTxnNumber(), rawResponse: resData };
  } catch (e) { return { status: 'error', message: e.message }; }
};

// 2. AUTO UPI UNIVERSAL PATCH
const originalProcessAutoUpiPayoutFn = processAutoUpiPayout;
processAutoUpiPayout = async function({ bot, userId, amount, gateway, upiId }) {
  try {
    let apiUrl = gateway.apiUrl || "";
    let method = (gateway.method || "GET").toUpperCase();
    let token = gateway.apiKey || "";
    let finalUrl = apiUrl;
    
    if (finalUrl.includes("{upi_id}") || finalUrl.includes("{upi}") || finalUrl.includes("{amount}")) {
        finalUrl = finalUrl.replace(/{upi_id}/g, encodeURIComponent(upiId)).replace(/{upi}/g, encodeURIComponent(upiId)).replace(/{amount}/g, amount).replace(/{token}/g, token);
        if (token && !finalUrl.includes("token=") && !finalUrl.includes(token)) finalUrl += `${finalUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
    } else {
        finalUrl = `${apiUrl}${apiUrl.includes("?") ? "&" : "?"}${token ? `token=${encodeURIComponent(token)}&` : ""}upi=${encodeURIComponent(upiId)}&amount=${amount}&order_id=AUTO${Date.now()}`;
    }

    let response, resData;
    try {
      response = await axios({ method, url: finalUrl, timeout: 30000 });
      try { resData = JSON.stringify(response.data); } catch (e) { resData = String(response.data); }
    } catch (apiErr) { return { status: 'error', message: apiErr.response?.data?.message || apiErr.message }; }

    let isSuccess = false, txnId = null;
    try {
      let data = response.data;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { } }
      if (data && typeof data === 'object') {
        isSuccess = data.status === 'success' || data.status === 'Success' || data.success === true;
        txnId = data.txn_id || data.transaction_id || data.order_id || null;
      }
    } catch (e) { }

    if (!isSuccess) return { status: 'failed', message: response.data?.message || 'Gateway declined', rawResponse: resData };

    let user = await User.findOne({ userId });
    if (!user) return { status: 'error', message: 'User not found' };

    let msg = `✅ <b>New Auto UPI Withdrawal</b> ✅\n\n🟢 <b>User :</b> <b>${userId}</b>\n🤘 <b>Remaining Balance :-</b> ₹<code>${user.balance.toFixed(2)}</code>\n\n🚀 <b>Amount :</b> ₹<b><code>${amount}</code></b> INR (-)\n🏦 <b>UPI :</b> <b><code>${halfMaskUPI(upiId)}</code></b>\n🌐 <b>Gateway :</b> ${gateway.name}\n\n💡 <b>Bot:</b> @${bot.botInfo ? bot.botInfo.username : "Bot"}\n\n⚠️ <b>${gateway.name} Response:</b>\n<code>${resData}</code>`;

    let payoutChannel = await getPayoutChannel("auto_upi");
    if (payoutChannel && payoutChannel !== "Not Set") try { await bot.api.sendMessage(payoutChannel, msg, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }

    return { status: 'success', txnNumber: txnId || generateTxnNumber(), rawResponse: resData };
  } catch (e) { return { status: 'error', message: e.message }; }
};

// 3. AUTO BANK GATEWAY SCHEMA & LOGIC
const autoBankSchema = new mongoose.Schema({
  gatewayId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  apiUrl: { type: String, required: true },
  method: { type: String, default: "GET" },
  status: { type: String, default: "active" },
  minAmount: { type: Number, default: 0 },
  maxAmount: { type: Number, default: 0 },
  taxPercent: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const AutoBank = mongoose.models.AutoBank || mongoose.model("AutoBank", autoBankSchema);

// 4. OVERRIDE ADMIN TEXT INPUT (For Auto UPI & Auto Bank)
const originalHandleAdminTextInputFn = handleAdminTextInput;
handleAdminTextInput = async function(ctx, text, userId, state) {
    if (state === "AUTO_UPI_ADVANCED_INPUT") {
        delete userState[userId];
        let parts = text.trim().split("::").map(p => p.trim());
        let name, method, url, apiKey = "";
        
        if (parts.length === 4) { name = parts[0].toUpperCase(); method = parts[1].toUpperCase(); url = parts[2]; apiKey = parts[3]; }
        else if (parts.length === 3) { name = parts[0].toUpperCase(); method = parts[1].toUpperCase(); url = parts[2]; }
        else if (parts.length === 2) { name = parts[0].toUpperCase(); method = "GET"; url = parts[1]; }
        else { await ctx.reply(`❌ Invalid format!\nUse: <code>NAME::METHOD::URL::TOKEN</code>`, {parse_mode: "HTML"}).catch(() => { }); return true; }
        
        if (!name || name.length < 2) { await ctx.reply(`❌ Name too short!`).catch(() => { }); return true; }
        if (!["GET", "POST"].includes(method)) method = "GET";
        if (!url.startsWith("http")) { await ctx.reply(`❌ Invalid URL!`).catch(() => { }); return true; }
        
        let existing = await AutoUpi.findOne({ name });
        if (existing) { await ctx.reply(`❌ Already exists!`).catch(() => { }); return true; }
        
        let gwId = "AUTO" + Date.now().toString().slice(-8);
        await AutoUpi.create({ gatewayId: gwId, name, apiUrl: url, method, apiKey, status: "active", minAmount: 0, maxAmount: 0, taxPercent: 0 });
        
        await logAdminAction(userId, ctx.from.first_name || "Admin", "Auto UPI Added (Advanced)", name, 0, null);
        await ctx.reply(`✅ <b>Auto UPI Added!</b>\n\n🌐 ${name}\n🟢 ON\nMethod: ${method}\n${apiKey ? `🔑 Token/Key: <code>${apiKey.substring(0, 8)}...</code>\n` : ""}\nURL:\n<code>${url}</code>`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("View", `auto_upi_view_${gwId}`).row().text("Back", "adm_auto_upi") }).catch(() => { });
        return true;
    }

    if (state === "AUTO_BANK_ADD") {
        delete userState[userId];
        let parts = text.trim().split("::").map(p => p.trim());
        let name, url;
        if (parts.length === 2) { name = parts[0].toUpperCase().replace(/\s+/g, "_"); url = parts[1]; }
        else { name = "BANK_" + Date.now().toString().slice(-6); url = text.trim(); }
        
        if (!url.startsWith("http")) { await ctx.reply(`❌ Invalid URL!`).catch(() => { }); return true; }
        
        let gwId = "ABG" + Date.now().toString().slice(-8);
        await AutoBank.create({ gatewayId: gwId, name, apiUrl: url, status: "active", minAmount: 0, maxAmount: 0, taxPercent: 0 });
        
        await ctx.reply(`✅ <b>Auto Bank Gateway Added!</b>\n\n🌐 ${name}\n🟢 ON\nURL:\n<code>${url}</code>`, { 
            parse_mode: "HTML", 
            reply_markup: new InlineKeyboard().text("View", `auto_bank_view_${gwId}`).row().text("Back", "adm_auto_bank") 
        }).catch(() => { });
        return true;
    }

    return await originalHandleAdminTextInputFn(ctx, text, userId, state);
};

// 5. RENDER WITHDRAWAL STEP WITH AUTO BANK BUTTON
const originalRenderWithdrawalStepFn = renderWithdrawalStep;
renderWithdrawalStep = async function(ctx) {
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let text = `🚀 <b>Withdrawal Step</b>\n\nChoose withdrawal method:`;
  let kb = new InlineKeyboard()
    .text(makeBtn("🌐 Gateway"), "adm_gateway_list").row()
    .text(makeBtn("⚡ Auto UPI"), "adm_auto_upi").row()
    .text(makeBtn("🏦 Auto Bank Gateway"), "adm_auto_bank").row()
    .text(makeBtn("Back to Admin"), "admin");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
};

// 6. AUTO BANK ADMIN CALLBACKS
bot.callbackQuery("adm_auto_bank", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  let banks = await AutoBank.find({}).sort({ createdAt: 1 }).lean();
  let text = `🏦 <b>Auto Bank Gateways</b>\n\nTotal: ${banks.length}\n\n`;
  let kb = new InlineKeyboard().text(makeBtn("➕ Add Bank Gateway"), "auto_bank_add").row();
  for (let b of banks) {
    kb.text(`${b.status === "active" ? "🟢" : "🔴"} ${b.name}`, `auto_bank_view_${b.gatewayId}`).row();
  }
  kb.text(makeBtn("Back"), "adm_gateway_menu");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("auto_bank_add", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "AUTO_BANK_ADD";
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  await ctx.editMessageText(`➕ <b>Add Auto Bank Gateway</b>\n\nFormat:\n<code>NAME::URL</code>\n\nExample:\n<code>ICICI::https://api.bank.com/payout?acc={account}&ifsc={ifsc}&amount={amount}</code>`, { 
    parse_mode: "HTML", 
    reply_markup: new InlineKeyboard().text(makeBtn("Cancel"), "adm_auto_bank") 
  }).catch(() => { });
});

bot.callbackQuery(/^auto_bank_view_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  let gwId = ctx.callbackQuery.data.replace("auto_bank_view_", "");
  let bank = await AutoBank.findOne({ gatewayId: gwId }).lean();
  if (!bank) return;
  const pad = "\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003";
  const makeBtn = (text) => `${pad}${text}${pad}`;
  
  let text = `🏦 <b>${bank.name}</b>\n\nStatus: ${bank.status === "active" ? "🟢 ON" : "🔴 OFF"}\nURL:\n<code>${bank.apiUrl}</code>`;
  let kb = new InlineKeyboard()
    .text(makeBtn(bank.status === "active" ? "Turn OFF" : "Turn ON"), `auto_bank_toggle_${gwId}`).row()
    .text(makeBtn("Delete"), `auto_bank_del_${gwId}`).row()
    .text(makeBtn("Back"), "adm_auto_bank");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^auto_bank_toggle_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  let gwId = ctx.callbackQuery.data.replace("auto_bank_toggle_", "");
  let bank = await AutoBank.findOne({ gatewayId: gwId });
  if (bank) { bank.status = bank.status === "active" ? "off" : "active"; await bank.save(); }
  await rerender(ctx, `auto_bank_view_${gwId}`);
});

bot.callbackQuery(/^auto_bank_del_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  let gwId = ctx.callbackQuery.data.replace("auto_bank_del_", "");
  await AutoBank.deleteOne({ gatewayId: gwId });
  await rerender(ctx, `adm_auto_bank`);
});

// 7. OVERRIDE WITHDRAW MENU TO INCLUDE AUTO BANK
const originalBuildWithdrawMenuFn = buildWithdrawMenu;
buildWithdrawMenu = async function() {
  let buttons = await originalBuildWithdrawMenuFn();
  let banks = await AutoBank.find({ status: "active" }).lean();
  for (let b of banks) {
    let shortName = b.name.length > 15 ? b.name.substring(0, 15) + ".." : b.name;
    buttons.push([{ text: `🏦 ${shortName}`, callback_data: `wd_bank_${b.gatewayId}` }]);
  }
  return buttons;
};

// 8. USER WITHDRAWAL FLOW FOR AUTO BANK
bot.callbackQuery(/^wd_bank_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  let userId = ctx.from.id;
  let gwId = ctx.callbackQuery.data.replace("wd_bank_", "");
  let bank = await AutoBank.findOne({ gatewayId: gwId, status: "active" });
  if (!bank) return ctx.reply("❌ Gateway not available").catch(() => { });
  
  let user = await getUser(userId);
  if (!user.bankAccNo || user.bankAccNo === "Not Set" || !user.bankIfsc || user.bankIfsc === "Not Set") {
    return ctx.reply(`❌ Please link your Bank Account first from Payout Method.`, { 
      reply_markup: new InlineKeyboard().text("Payout Method", "btn_payout_back") 
    }).catch(() => { });
  }
  
  userState[userId] = `AUTO_BANK_AMOUNT_${gwId}`;
  await ctx.reply(`Enter Withdraw Amount`, { reply_markup: new Keyboard().text("Cancel").resized().oneTime() }).catch(() => { });
});

// Catch Amount Input for Auto Bank
bot.on("message:text", async (ctx, next) => {
    let state = userState[ctx.from.id];
    if (!state || !state.startsWith("AUTO_BANK_AMOUNT_")) return next();
    
    if (ctx.message.text.trim().toLowerCase() === "cancel") {
        delete userState[ctx.from.id];
        await ctx.reply(`✅ Cancelled`, { reply_markup: await buildKeyboardFromLayout(ctx.from.id) }).catch(() => { });
        return;
    }
    
    let amount = parseFloat(ctx.message.text);
    if (isNaN(amount) || amount <= 0) return ctx.reply("❌ Invalid amount. Try again or type 'Cancel'").catch(() => { });
    
    delete userState[ctx.from.id];
    let gwId = state.replace("AUTO_BANK_AMOUNT_", "");
    let bank = await AutoBank.findOne({ gatewayId: gwId, status: "active" });
    if (!bank) return ctx.reply("❌ Gateway not available").catch(() => { });
    
    let user = await getUser(ctx.from.id);
    if (user.balance < amount) return ctx.reply(`❌ Insufficient balance. Your Balance: ₹${user.balance.toFixed(2)}`, { reply_markup: await buildKeyboardFromLayout(ctx.from.id) }).catch(() => { });
    
    user.balance -= amount;
    await user.save();
    await logBalanceHistory(ctx.from.id, `Withdrawn via Bank (${bank.name})`, -amount);
    
    let msg = await ctx.reply(`⏳ Processing ${buildProcessingDots(0)}`, { parse_mode: "HTML" }).catch(() => null);
    if (!msg) return;
    
    let finalUrl = bank.apiUrl
        .replace(/{account}/g, encodeURIComponent(user.bankAccNo))
        .replace(/{acc_no}/g, encodeURIComponent(user.bankAccNo))
        .replace(/{ifsc}/g, encodeURIComponent(user.bankIfsc))
        .replace(/{amount}/g, amount)
        .replace(/{comment}/g, encodeURIComponent("WD" + Date.now()))
        .replace(/{userId}/g, ctx.from.id);
        
    let isSuccess = false;
    let resData = "";
    let txnId = null;
    try {
        let res = await axios.get(finalUrl, { timeout: 30000 });
        resData = JSON.stringify(res.data);
        isSuccess = (res.data && (res.data.status === "success" || res.data.success === true)) || /success|completed|done|paid|processed/i.test(resData);
        txnId = res.data?.txn_id || res.data?.txnId || res.data?.orderId || "WD" + Date.now();
    } catch (e) {
        resData = e.message;
    }
    
    if (isSuccess) {
        await ctx.api.editMessageText(ctx.chat.id, msg.message_id, 
            `🎁 Your Withdrawal of Rs.<code>${amount.toFixed(2)}</code> is Successfully Processed!🔥🔥\n\n` +
            `🏦 Destination ==> <code>${halfMaskBank(user.bankAccNo)}</code>\n` +
            `🚀 Transaction ID ==> <code>${txnId}</code>\n\n` +
            `✅ Please Check Your Bank Account!`, 
            { parse_mode: "HTML", reply_markup: await buildKeyboardFromLayout(ctx.from.id) }
        ).catch(() => { });
    } else {
        user.balance += amount;
        await user.save();
        await logBalanceHistory(ctx.from.id, "Bank Withdrawal Failed (Refunded)", amount);
        await ctx.api.editMessageText(ctx.chat.id, msg.message_id, 
            `❌ Withdrawal Failed\n\nAmount: ₹${amount.toFixed(2)}\nRefunded: ₹${user.balance.toFixed(2)}`, 
            { parse_mode: "HTML", reply_markup: await buildKeyboardFromLayout(ctx.from.id) }
        ).catch(() => { });
    }
    return;
});

 setInterval(() => {
  let renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderUrl) fetch(renderUrl).catch(() => { });
}, 300000);

setInterval(() => {
  if (global.quickPayCache) { for (let uid in global.quickPayCache) delete global.quickPayCache[uid]; }
  if (global.broadcastCache) { for (let uid in global.broadcastCache) delete global.broadcastCache[uid]; }
  if (global.taskCreation) { for (let uid in global.taskCreation) delete global.taskCreation[uid]; }
}, 30 * 60 * 1000);

                    
