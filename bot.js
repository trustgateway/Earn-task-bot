require("dotenv").config();
const { Bot, Keyboard, InlineKeyboard, InputFile } = require("grammy");
const mongoose = require("mongoose");
const express = require("express");
const path = require("path");
const axios = require("axios");

const RUPEE = String.fromCharCode(8377);
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
  console.error("BOT_TOKEN & MONGO_URI required!");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);
const userState = {};
const CURRENT_LAYOUT_VERSION = "v3.0.0";

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
  if (method === "UPI" || method === "AUTO_UPI" || method === "AUTO_BANK") return halfMaskUPI(details);
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

function generatePaymentRef() {
  return "PAY" + Date.now() + Math.floor(Math.random() * 1000);
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
  if (num < 0) return `-${RUPEE}${Math.abs(num).toFixed(2)}`;
  return `${RUPEE}${num.toFixed(2)}`;
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

function calculateFixedTax(amount, slabs) {
  if (!slabs || !Array.isArray(slabs) || slabs.length === 0) return 0;
  var amt = Number(amount);
  for (var i = 0; i < slabs.length; i++) {
    var s = slabs[i];
    var min = Number(s.min);
    var max = Number(s.max);
    var tax = Number(s.tax);
    if (amt >= min && amt <= max) return tax;
  }
  return 0;
}

function parseTaxSlabInput(input) {
  var str = String(input || "").trim();
  var parts = str.split(/\s+/).filter(function(p) { return p !== ""; });
  if (parts.length !== 3) return null;
  var min = parseFloat(parts[0]);
  var max = parseFloat(parts[1]);
  var tax = parseFloat(parts[2]);
  if (isNaN(min) || isNaN(max) || isNaN(tax)) return null;
  if (min < 0 || max < 0 || tax < 0) return null;
  if (min >= max) return null;
  return { min: min, max: max, tax: tax };
}

function removeUPIFieldsFromResponse(responseData) {
  try {
    var data = typeof responseData === 'string' ? JSON.parse(responseData) : responseData;
    if (!data || typeof data !== 'object') return responseData;
    var upiFields = ['upi', 'upi_id', 'vpa', 'address', 'payee', 'payee_upi', 'payee_vpa', 'account', 'wallet', 'phone', 'mobile'];
    function cleanObj(obj) {
      if (!obj || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(cleanObj);
      var cleaned = {};
      for (var key in obj) {
        if (upiFields.indexOf(key.toLowerCase()) >= 0) continue;
        cleaned[key] = cleanObj(obj[key]);
      }
      return cleaned;
    }
    return JSON.stringify(cleanObj(data));
  } catch (e) {
    return String(responseData);
  }
}

function parseInlineButtons(input) {
  if (!input || !input.trim()) return null;
  var lines = input.trim().split("\n").filter(function(l) { return l.trim() !== ""; });
  var rows = [];
  for (var i = 0; i < lines.length; i++) {
    var parts = lines[i].trim().split("&&").map(function(p) { return p.trim(); }).filter(function(p) { return p !== ""; });
    var rowButtons = [];
    for (var j = 0; j < parts.length; j++) {
      var match = parts[j].match(/^(.+?)\s*-\s*(https?:\/\/\S+)\s*$/);
      if (match) rowButtons.push({ text: match[1].trim(), url: match[2].trim() });
    }
    if (rowButtons.length > 0) rows.push(rowButtons);
  }
  return rows.length > 0 ? rows : null;
}

function buildInlineKeyboardFromRows(rows) {
  if (!rows || rows.length === 0) return null;
  var inline_keyboard = [];
  for (var i = 0; i < rows.length; i++) {
    var btnRow = [];
    for (var j = 0; j < rows[i].length; j++) {
      btnRow.push({ text: rows[i][j].text, url: rows[i][j].url });
    }
    inline_keyboard.push(btnRow);
  }
  return { inline_keyboard: inline_keyboard };
}

function formatMinutes(min) {
  if (min < 60) return `${min} minutes`;
  if (min < 1440) return `${min / 60} hour(s)`;
  return `${min / 1440} day(s)`;
}

function buildProcessingDots(frame) {
  const dots = ["●  ○  ○", "●  ●  ○", "●  ●  ●", "○  ●  ●", "○  ○  ●"];
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

function buildSuccessMessage(amount, masked, txnNumber, processTime, methodName) {
  return "\uD83C\uDF81 Your Withdrawal of Rs.<code>" + amount.toFixed(2) + "</code> is Successfully Processed!\uD83D\uDD25\uD83D\uDD25\n\n" +
    "\uD83C\uDFE6 Destination ==> <code>" + masked + "</code>\n" +
    "\uD83D\uDE80 Transaction ID ==> <code>" + txnNumber + "</code>\n" +
    "\uD83D\uDDD3\uFE0F Date and time ==> " + formatDateTime(processTime) + "\n\n" +
    "\u2705 Please Check Your " + methodName + " Account!";
}

function buildManualPendingMessage(amount, methodLabel, maskedDetails, userWithdrawalCount, taxAmount, netAmount, newBalance) {
  var taxLine;
  if (taxAmount > 0) {
    taxLine = "\uD83D\uDCC9 Tax: " + RUPEE + taxAmount.toFixed(2) + " | \u2705 Receive: " + RUPEE + netAmount.toFixed(2);
  } else {
    taxLine = "\u2705 Receive: " + RUPEE + amount.toFixed(2) + " (no tax)";
  }
  var methodIcon = methodLabel === "UPI" ? "\u26A1" : "\uD83C\uDF81";
  return "\u2705 REQUEST SUBMITTED\n\n" +
    "\uD83D\uDCB8 " + RUPEE + amount.toFixed(2) + " \u2192 " + methodLabel + "\n" +
    methodIcon + " " + maskedDetails + "\n" +
    "\uD83C\uDD94 #" + userWithdrawalCount + "\n\n" +
    taxLine + "\n" +
    "\uD83D\uDCB5 New Balance: " + RUPEE + newBalance.toFixed(2) + "\n\n" +
    "\u23F3 Pending admin approval...";
}

function buildPayoutChannelMessage(methodLabel, userWithdrawalCount, userId, amount, netAmount, maskedDetails, paymentRef, statusText) {
  var methodIcon = methodLabel === "UPI" ? "\u26A1" : "\uD83C\uDF81";
  var userLink = '<a href="tg://user?id=' + userId + '"><b>' + userId + '</b></a>';
  return "\u26A0\uFE0F New " + methodLabel + " Payout Request! (#" + userWithdrawalCount + ")\n\n" +
    "User : " + userLink + "\n" +
    "Request Amount : " + RUPEE + amount + "\n" +
    "Amount After Tax : " + RUPEE + netAmount.toFixed(2) + "\n" +
    "UPI ID : " + maskedDetails + "\n" +
    "Payment Ref : " + paymentRef + "\n\n" +
    "Manual UPI Response : " + statusText;
}

function buildWithdrawalConfirmMessage(amount, payoutAmount, taxAmount, walletOrUpi) {
  var bodyText = "Amount: <code>" + amount + "</code> INR\n" +
    "You receive: <code>" + payoutAmount.toFixed(2) + "</code> INR (Tax: <code>" + RUPEE + taxAmount.toFixed(2) + "</code>)\n\n" +
    "Wallet: <code>" + walletOrUpi + "</code>";
  return "<b>Withdrawal Confirmation</b>\n\n<blockquote>" + bodyText + "</blockquote>\n\nConfirm your transaction by clicking Confirm";
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
  paymentRef: { type: String, default: "" },
  taxPercent: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  netAmount: { type: Number, default: 0 },
  oldBalance: { type: Number, default: 0 },
  newBalance: { type: Number, default: 0 },
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
  taxSlabs: { type: Array, default: [] },
  payoutChannel: { type: String, default: "" },
  createdBy: { type: Number, default: null },
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});
const Gateway = mongoose.models.Gateway || mongoose.model("Gateway", gatewaySchema);

const autoUpiSchema = new mongoose.Schema({
  gatewayId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  apiUrl: { type: String, required: true },
  apiKey: { type: String, default: "" },
  method: { type: String, default: "GET" },
  status: { type: String, default: "active" },
  minAmount: { type: Number, default: 0 },
  maxAmount: { type: Number, default: 0 },
  taxPercent: { type: Number, default: 0 },
  taxSlabs: { type: Array, default: [] },
  payoutChannel: { type: String, default: "" },
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
  taxSlabs: { type: Array, default: [] },
  payoutChannel: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now }
});
const AutoBank = mongoose.models.AutoBank || mongoose.model("AutoBank", autoBankSchema);

const withdrawSettingsSchema = new mongoose.Schema({
  method: { type: String, required: true, unique: true },
  isActive: { type: Boolean, default: true },
  minAmount: { type: Number, default: 0 },
  maxAmount: { type: Number, default: 0 },
  taxPercent: { type: Number, default: 0 },
  taxSlabs: { type: Array, default: [] },
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
  { name: `📋 ${toSmallCaps("Bot Task")}`, key: "btn_tasks", row: 0, hidden: false, style: "" },
  { name: `💸 ${toSmallCaps("My Balance")}`, key: "btn_balance", row: 0, hidden: false, style: "" },
  { name: `🎁 ${toSmallCaps("Gift Code")}`, key: "btn_gift", row: 1, hidden: false, style: "" },
  { name: `⚡ ${toSmallCaps("Quick Pay")}`, key: "btn_quickpay", row: 1, hidden: false, style: "" },
  { name: `💳 ${toSmallCaps("Payout Method")}`, key: "btn_payout", row: 2, hidden: false, style: "" },
  { name: `🚀 ${toSmallCaps("Withdraw")}`, key: "btn_withdraw", row: 2, hidden: false, style: "" }
];

const DEFAULT_ADMIN_PANEL_LAYOUT = [
  { name: `👮 Add/Remove Admins Permission`, key: "adm_permissions", row: 0, hidden: false, style: "" },
  { name: `👑 Transfer Ownership`, key: "adm_transfer", row: 1, hidden: false, style: "" },
  { name: `💰 Set Tax Slabs`, key: "adm_tax_menu", row: 1, hidden: false, style: "" },
  { name: `👮 Manage Admins`, key: "adm_admins", row: 2, hidden: false, style: "" },
  { name: `🚫 Manage Ban Users`, key: "adm_manage_ban", row: 2, hidden: false, style: "" },
  { name: `🤖 Bot Status`, key: "adm_bot_status", row: 3, hidden: false, style: "" },
  { name: `🚫 Manage Ban Wallet`, key: "adm_manage_ban_wallet", row: 3, hidden: false, style: "" },
  { name: `💸 Withdraw Status`, key: "adm_wd_status", row: 4, hidden: false, style: "" },
  { name: `➕ Add Balance`, key: "adm_add_bal", row: 4, hidden: false, style: "" },
  { name: `➖ Remove Balance`, key: "adm_rem_bal", row: 5, hidden: false, style: "" },
  { name: `⚡ Manage Your Channels`, key: "adm_manage_channels", row: 5, hidden: false, style: "" },
  { name: `⚠️ Reset Balance`, key: "adm_reset_all_bal", row: 6, hidden: false, style: "" },
  { name: `🎨 Customize Your Theme`, key: "adm_customize_theme", row: 6, hidden: false, style: "" },
  { name: `💬 Talk With User`, key: "adm_talk_user", row: 7, hidden: false, style: "" },
  { name: `📢 Broadcast`, key: "adm_broadcast", row: 7, hidden: false, style: "" },
  { name: `🔍 Find User Details`, key: "adm_find_user", row: 8, hidden: false, style: "" },
  { name: `📊 Status`, key: "adm_status", row: 8, hidden: false, style: "" },
  { name: `⚡ Quick Pay`, key: "adm_quick_pay", row: 9, hidden: false, style: "" },
  { name: `🚀 Withdrawal Step`, key: "adm_gateway_menu", row: 9, hidden: false, style: "" },
  { name: `🎁 Gift Codes`, key: "adm_create_gift", row: 10, hidden: false, style: "" },
  { name: `🔔 New User Notification`, key: "adm_user_notif", row: 11, hidden: false, style: "" },
  { name: `🎁 Manage Redeem Codes`, key: "adm_redeem", row: 11, hidden: false, style: "" },
  { name: `📧 Manage Amazon Codes`, key: "adm_amazon", row: 12, hidden: false, style: "" },
  { name: `📋 Manage Tasks`, key: "adm_tasks_manager", row: 12, hidden: false, style: "" },
  { name: `📢 User Update`, key: "adm_user_update", row: 13, hidden: false, style: "" },
  { name: `🚀 Recent Admin Actions`, key: "adm_recent_actions", row: 13, hidden: false, style: "" },
  { name: `🔄 Refresh Panel`, key: "admin", row: 14, hidden: false, style: "" }
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
    console.log(`Configs preloaded: ${allConfigs.length} keys`);
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

async function getMethodPayoutChannel(method, methodObj) {
  if (methodObj && methodObj.payoutChannel && methodObj.payoutChannel !== "") return methodObj.payoutChannel;
  var specific = await getConfig("payout_channel_" + method.toLowerCase(), null);
  if (specific && specific !== "Not Set") return specific;
  return await getPayoutChannel(method);
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
  var userPref = await UserPreference.findOne({ userId: userId }).lean();
  var layout;
  if (userPref && userPref.keyboardLayout && userPref.keyboardLayout.length > 0) layout = userPref.keyboardLayout;
  else {
    var freshConfig = await Config.findOne({ key: "keyboard_layout" }).lean();
    layout = (freshConfig && freshConfig.value) ? freshConfig.value : DEFAULT_KEYBOARD_LAYOUT;
    configCache.data["keyboard_layout"] = layout;
  }
  var keyboardRows = [];
  var maxRow = layout.length > 0 ? Math.max.apply(null, layout.map(function(b) { return b.row; })) : 0;
  for (var r = 0; r <= maxRow; r++) {
    var rowButtons = layout.filter(function(b) { return b.row === r && !b.hidden; });
    if (rowButtons.length > 0) {
      var row = rowButtons.map(function(btn) {
        var b = { text: btn.name };
        if (btn.style && ["primary", "success", "danger"].indexOf(btn.style) >= 0) b.style = btn.style;
        return b;
      });
      keyboardRows.push(row);
    }
  }
  if (keyboardRows.length === 0) keyboardRows = [[{ text: `💸 ${toSmallCaps("My Balance")}` }]];
  return { keyboard: keyboardRows, resize_keyboard: true, is_persistent: false, one_time_keyboard: false };
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
    let text = await getConfig("unknown_command_text", "I didn't understand that.\n\nPlease /start the bot again.");
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

async function processGatewayPayout(opts) {
  try {
    var bot = opts.bot;
    var userId = opts.userId;
    var amount = opts.amount;
    var payoutAmount = opts.payoutAmount;
    var gatewayInfo = opts.gatewayInfo;
    var wallet = opts.wallet;
    var channelList = opts.channelList || [];
    var urlTemplate = gatewayInfo.url_template || gatewayInfo.url || "";
    var finalUrl = urlTemplate
      .replace(/{wallet}/g, encodeURIComponent(wallet))
      .replace(/{number}/g, encodeURIComponent(wallet))
      .replace(/{amount}/g, encodeURIComponent(payoutAmount))
      .replace(/{userId}/g, encodeURIComponent(userId))
      .replace(/{orderId}/g, encodeURIComponent("WD" + Date.now()))
      .replace(/{txnId}/g, encodeURIComponent("TXN" + Date.now()))
      .replace(/{timestamp}/g, encodeURIComponent(Date.now()));
    var response, resData;
    try {
      response = await axios.get(finalUrl, { timeout: 30000 });
      try { resData = JSON.stringify(response.data); } catch (e) { resData = String(response.data); }
    } catch (apiErr) {
      var apiMsg = (apiErr.response && apiErr.response.data && apiErr.response.data.message) || apiErr.message || 'Gateway request failed';
      return { status: 'error', message: apiMsg };
    }
    var isSuccess = false;
    var txnNumber = null;
    try {
      var data = response.data;
      var jsonData = null;
      if (typeof data === 'string') { try { jsonData = JSON.parse(data); } catch (e) { } }
      else if (data && typeof data === 'object') jsonData = data;
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
      var errMsg = 'Gateway declined';
      if (response.data && response.data.message) errMsg = response.data.message;
      else if (resData && resData.length < 100) errMsg = resData;
      return { status: 'failed', message: errMsg, rawResponse: resData ? resData.substring(0, 300) : '' };
    }
    var user = await User.findOne({ userId: userId });
    if (!user) return { status: 'error', message: 'User not found' };
    var maskedWallet = halfMaskWallet(wallet);
    var cleanResponse = removeUPIFieldsFromResponse(resData);
    var now = new Date();
    var msg = "\u2705 New Withdrawal Processed \u2705\n\n" +
      "\uD83D\uDFE2 User : " + userId + "\n" +
      "\u270C\uFE0FOld Balance :- " + RUPEE + (user.balance + amount).toFixed(2) + "\n" +
      "\u270C\uFE0FRemaining Balance :- " + RUPEE + user.balance.toFixed(2) + "\n\n" +
      "\uD83D\uDE80Amount : " + RUPEE + payoutAmount.toFixed(2) + " INR ( " + RUPEE + (amount - payoutAmount).toFixed(2) + " Tax )\n" +
      "\u26D4 Address : " + maskedWallet + "\n" +
      "\uD83D\uDCB3 Payment Ref : " + (txnNumber || generateTxnNumber()) + "\n\n" +
      "\uD83D\uDD52 Time : " + formatDateTime(now) + "\n\n" +
      "\uD83D\uDCA1 Bot : @" + (bot.botInfo ? bot.botInfo.username : "Bot") + "\n\n" +
      "\u26A0\uFE0FGateway Response :- " + cleanResponse;
    for (var i = 0; i < channelList.length; i++) {
      if (channelList[i]) try { await bot.api.sendMessage(channelList[i], msg, { parse_mode: "HTML" }).catch(function() { }); } catch (e) { }
    }
    return { status: 'success', txnNumber: txnNumber || generateTxnNumber(), rawResponse: resData };
  } catch (e) { return { status: 'error', message: e.message }; }
}

async function processAutoUpiPayout(opts) {
  try {
    var bot = opts.bot;
    var userId = opts.userId;
    var amount = opts.amount;
    var payoutAmount = opts.payoutAmount;
    var gateway = opts.gateway;
    var upiId = opts.upiId;
    var apiUrl = gateway.apiUrl || "";
    var method = (gateway.method || "GET").toUpperCase();
    var token = gateway.apiKey || "";
    var finalUrl = apiUrl;
    if (finalUrl.indexOf("{upi_id}") >= 0 || finalUrl.indexOf("{upi}") >= 0 || finalUrl.indexOf("{amount}") >= 0) {
      finalUrl = finalUrl.replace(/{upi_id}/g, encodeURIComponent(upiId)).replace(/{upi}/g, encodeURIComponent(upiId)).replace(/{amount}/g, payoutAmount).replace(/{token}/g, token);
      if (token && finalUrl.indexOf("token=") < 0 && finalUrl.indexOf(token) < 0) finalUrl += (finalUrl.indexOf("?") >= 0 ? "&" : "?") + "token=" + encodeURIComponent(token);
    } else {
      finalUrl = apiUrl + (apiUrl.indexOf("?") >= 0 ? "&" : "?") + (token ? "token=" + encodeURIComponent(token) + "&" : "") + "upi=" + encodeURIComponent(upiId) + "&amount=" + payoutAmount + "&order_id=AUTO" + Date.now();
    }
    var response, resData;
    try {
      response = await axios({ method: method, url: finalUrl, timeout: 30000 });
      try { resData = JSON.stringify(response.data); } catch (e) { resData = String(response.data); }
    } catch (apiErr) {
      var apiMsg2 = (apiErr.response && apiErr.response.data && apiErr.response.data.message) || apiErr.message;
      return { status: 'error', message: apiMsg2 };
    }
    var isSuccess = false, txnId = null;
    try {
      var data = response.data;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { } }
      if (data && typeof data === 'object') {
        isSuccess = data.status === 'success' || data.status === 'Success' || data.success === true;
        txnId = data.txn_id || data.transaction_id || data.order_id || null;
      }
      if (!isSuccess && resData && /success|completed|done|paid/i.test(resData)) isSuccess = true;
    } catch (e) { }
    if (!isSuccess) return { status: 'failed', message: (response.data && response.data.message) || 'Gateway declined', rawResponse: resData ? resData.substring(0, 300) : '' };
    var user = await User.findOne({ userId: userId });
    if (!user) return { status: 'error', message: 'User not found' };
    var maskedUPI = halfMaskUPI(upiId);
    var cleanResponse = removeUPIFieldsFromResponse(resData);
    var now = new Date();
    var msg = "\u2705 New Auto UPI Withdrawal \u2705\n\n" +
      "\uD83D\uDFE2 User : " + userId + "\n" +
      "\u270C\uFE0FOld Balance :- " + RUPEE + (user.balance + amount).toFixed(2) + "\n" +
      "\u270C\uFE0FRemaining Balance :- " + RUPEE + user.balance.toFixed(2) + "\n\n" +
      "\uD83D\uDE80Amount : " + RUPEE + payoutAmount.toFixed(2) + " INR ( " + RUPEE + (amount - payoutAmount).toFixed(2) + " Tax )\n" +
      "\u26D4 Address : " + maskedUPI + "\n" +
      "\uD83D\uDCB3 Payment Ref : " + (txnId || generateTxnNumber()) + "\n\n" +
      "\uD83D\uDD52 Time : " + formatDateTime(now) + "\n\n" +
      "\uD83D\uDCA1 Bot : @" + (bot.botInfo ? bot.botInfo.username : "Bot") + "\n\n" +
      "\u26A0\uFE0FGateway Response :- " + cleanResponse;
    var payoutChannel = await getMethodPayoutChannel("auto_upi", gateway);
    if (payoutChannel && payoutChannel !== "Not Set") {
      try { await bot.api.sendMessage(payoutChannel, msg, { parse_mode: "HTML" }).catch(function() { }); } catch (e) { }
    }
    return { status: 'success', txnNumber: txnId || generateTxnNumber(), rawResponse: resData };
  } catch (e) { return { status: 'error', message: e.message }; }
}

async function processAutoBankPayout(opts) {
  try {
    var bot = opts.bot;
    var userId = opts.userId;
    var amount = opts.amount;
    var payoutAmount = opts.payoutAmount;
    var gateway = opts.gateway;
    var bankAccNo = opts.bankAccNo;
    var bankIfsc = opts.bankIfsc;
    var finalUrl = gateway.apiUrl
      .replace(/{account}/g, encodeURIComponent(bankAccNo))
      .replace(/{acc_no}/g, encodeURIComponent(bankAccNo))
      .replace(/{ifsc}/g, encodeURIComponent(bankIfsc))
      .replace(/{amount}/g, payoutAmount)
      .replace(/{comment}/g, encodeURIComponent("WD" + Date.now()))
      .replace(/{userId}/g, userId);
    var response, resData;
    try {
      response = await axios({ method: (gateway.method || "GET").toUpperCase(), url: finalUrl, timeout: 30000 });
      try { resData = JSON.stringify(response.data); } catch (e) { resData = String(response.data); }
    } catch (apiErr) {
      var apiMsg3 = (apiErr.response && apiErr.response.data && apiErr.response.data.message) || apiErr.message;
      return { status: 'error', message: apiMsg3 };
    }
    var isSuccess = false, txnId = null;
    try {
      var data = response.data;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { } }
      if (data && typeof data === 'object') {
        isSuccess = data.status === 'success' || data.status === 'Success' || data.success === true;
        txnId = data.txn_id || data.transaction_id || data.order_id || null;
      }
      if (!isSuccess && resData && /success|completed|done|paid/i.test(resData)) isSuccess = true;
    } catch (e) { }
    if (!isSuccess) return { status: 'failed', message: (response.data && response.data.message) || 'Gateway declined', rawResponse: resData ? resData.substring(0, 300) : '' };
    var user = await User.findOne({ userId: userId });
    if (!user) return { status: 'error', message: 'User not found' };
    var maskedBank = halfMaskBank(bankAccNo);
    var cleanResponse = removeUPIFieldsFromResponse(resData);
    var now = new Date();
    var msg = "\u2705 New Auto Bank Withdrawal \u2705\n\n" +
      "\uD83D\uDFE2 User : " + userId + "\n" +
      "\u270C\uFE0FOld Balance :- " + RUPEE + (user.balance + amount).toFixed(2) + "\n" +
      "\u270C\uFE0FRemaining Balance :- " + RUPEE + user.balance.toFixed(2) + "\n\n" +
      "\uD83D\uDE80Amount : " + RUPEE + payoutAmount.toFixed(2) + " INR ( " + RUPEE + (amount - payoutAmount).toFixed(2) + " Tax )\n" +
      "\u26D4 Address : " + maskedBank + "\n" +
      "\uD83D\uDCB3 Payment Ref : " + (txnId || generateTxnNumber()) + "\n\n" +
      "\uD83D\uDD52 Time : " + formatDateTime(now) + "\n\n" +
      "\uD83D\uDCA1 Bot : @" + (bot.botInfo ? bot.botInfo.username : "Bot") + "\n\n" +
      "\u26A0\uFE0FGateway Response :- " + cleanResponse;
    var payoutChannel = await getMethodPayoutChannel("auto_bank", gateway);
    if (payoutChannel && payoutChannel !== "Not Set") {
      try { await bot.api.sendMessage(payoutChannel, msg, { parse_mode: "HTML" }).catch(function() { }); } catch (e) { }
    }
    return { status: 'success', txnNumber: txnId || generateTxnNumber(), rawResponse: resData };
  } catch (e) { return { status: 'error', message: e.message }; }
}

async function atomicWithdraw(userId, amount, taxAmount, method, details, txnNumber, paymentRef, isGateway, gatewayName, gatewayResponse) {
  var user = await User.findOne({ userId: userId });
  if (!user) return null;
  var oldBalance = user.balance;
  if (oldBalance < amount) return null;
  user.balance -= amount;
  user.withdrawnTotal = (user.withdrawnTotal || 0) + amount;
  await user.save();
  var newBalance = user.balance;
  var approvedCount = await Withdrawal.countDocuments({ userId: userId, status: "Approved" });
  var userWithdrawalCount = approvedCount + 1;
  var withdrawalId = Math.floor(100000 + Math.random() * 900000).toString();
  await Withdrawal.create({
    withdrawalId: withdrawalId,
    userId: userId,
    userWithdrawalCount: userWithdrawalCount,
    amount: amount,
    method: method,
    details: details,
    status: isGateway ? "Approved" : "Pending",
    isGateway: isGateway,
    gatewayName: gatewayName || "",
    gatewayResponse: gatewayResponse || "",
    txnNumber: txnNumber || "",
    paymentRef: paymentRef || "",
    taxAmount: taxAmount,
    netAmount: amount - taxAmount,
    oldBalance: oldBalance,
    newBalance: newBalance,
    approvedBy: isGateway ? "Auto" : "",
    approvedAt: isGateway ? new Date() : null
  });
  if (taxAmount > 0) {
    var ownerId = await getConfig("owner_id", MAIN_OWNER_ID);
    await User.findOneAndUpdate({ userId: ownerId }, { $inc: { balance: taxAmount } });
    await logBalanceHistory(ownerId, "Withdrawal Tax (" + method + ")", taxAmount);
  }
  await logBalanceHistory(userId, "Withdrawn via " + method, -amount);
  return { withdrawalId: withdrawalId, userWithdrawalCount: userWithdrawalCount, oldBalance: oldBalance, newBalance: newBalance };
}

bot.callbackQuery("adm_tax_menu", async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var text = "<b>\uD83D\uDCB0 Set Tax Slabs</b>\n\nSelect method to configure tax:";
  var kb = new InlineKeyboard();
  var gateways = await Gateway.find({}).lean();
  for (var i = 0; i < gateways.length; i++) kb.row({ text: "\uD83C\uDF10 " + gateways[i].name, callback_data: "tax_edit_gw_" + gateways[i].name, style: "primary" });
  var autoUpis = await AutoUpi.find({}).lean();
  for (var j = 0; j < autoUpis.length; j++) kb.row({ text: "\u26A1 " + autoUpis[j].name, callback_data: "tax_edit_upi_" + autoUpis[j].gatewayId, style: "primary" });
  var autoBanks = await AutoBank.find({}).lean();
  for (var k = 0; k < autoBanks.length; k++) kb.row({ text: "\uD83C\uDFE6 " + autoBanks[k].name, callback_data: "tax_edit_bank_" + autoBanks[k].gatewayId, style: "primary" });
  var methods = ["upi", "bank", "amazon", "redeem"];
  for (var m = 0; m < methods.length; m++) kb.row({ text: methods[m].toUpperCase(), callback_data: "tax_edit_manual_" + methods[m], style: "primary" });
  kb.row({ text: "Back to Admin", callback_data: "admin", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
});

async function renderTaxSlabPage(ctx, slabs, type, identifier) {
  var bodyText = "";
  if (slabs.length === 0) bodyText = "\u274C No tax slabs added";
  else slabs.forEach(function(s, i) { bodyText += (i + 1) + ". " + RUPEE + s.min + " \u2192 " + RUPEE + s.max + " = " + RUPEE + s.tax + "\n"; });
  var text = "<b>\uD83D\uDCB0 Tax</b>\n\n<blockquote>" + bodyText + "</blockquote>";
  var kb = new InlineKeyboard();
  for (var i = 0; i < slabs.length; i++) {
    var s = slabs[i];
    kb.row(
      { text: RUPEE + s.min + "-" + RUPEE + s.max + " = " + RUPEE + s.tax, callback_data: "tax_view_" + type + "_" + identifier + "_" + i, style: "success" },
      { text: "\u270F\uFE0F", callback_data: "tax_edit_" + type + "_" + identifier + "_" + i, style: "primary" },
      { text: "\u274C", callback_data: "tax_del_" + type + "_" + identifier + "_" + i, style: "danger" }
    );
  }
  kb.row({ text: "\u2795 Add Tax", callback_data: "tax_add_" + type + "_" + identifier, style: "success" });
  kb.row({ text: "Back", callback_data: "adm_tax_menu", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
}

async function getSlabsForType(type, identifier) {
  if (type === "gw") { var gw = await Gateway.findOne({ name: identifier }).lean(); return gw ? (gw.taxSlabs || []) : []; }
  if (type === "upi") { var gw2 = await AutoUpi.findOne({ gatewayId: identifier }).lean(); return gw2 ? (gw2.taxSlabs || []) : []; }
  if (type === "bank") { var gw3 = await AutoBank.findOne({ gatewayId: identifier }).lean(); return gw3 ? (gw3.taxSlabs || []) : []; }
  if (type === "manual") { var s = await WithdrawSettings.findOne({ method: identifier }).lean(); return s ? (s.taxSlabs || []) : []; }
  return [];
}

async function saveSlabsForType(type, identifier, slabs) {
  if (type === "gw") await Gateway.updateOne({ name: identifier }, { taxSlabs: slabs, updatedAt: new Date() });
  else if (type === "upi") await AutoUpi.updateOne({ gatewayId: identifier }, { taxSlabs: slabs });
  else if (type === "bank") await AutoBank.updateOne({ gatewayId: identifier }, { taxSlabs: slabs });
  else if (type === "manual") { var s = await WithdrawSettings.findOne({ method: identifier }); if (!s) await WithdrawSettings.create({ method: identifier, taxSlabs: slabs }); else { s.taxSlabs = slabs; s.updatedAt = new Date(); await s.save(); } }
}

bot.callbackQuery(/^tax_edit_gw_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var name = ctx.callbackQuery.data.replace("tax_edit_gw_", "");
  var gw = await Gateway.findOne({ name: name }).lean();
  if (!gw) return;
  await renderTaxSlabPage(ctx, gw.taxSlabs || [], "gw", name);
});

bot.callbackQuery(/^tax_edit_upi_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("tax_edit_upi_", "");
  var gw = await AutoUpi.findOne({ gatewayId: gwId }).lean();
  if (!gw) return;
  await renderTaxSlabPage(ctx, gw.taxSlabs || [], "upi", gwId);
});

bot.callbackQuery(/^tax_edit_bank_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("tax_edit_bank_", "");
  var gw = await AutoBank.findOne({ gatewayId: gwId }).lean();
  if (!gw) return;
  await renderTaxSlabPage(ctx, gw.taxSlabs || [], "bank", gwId);
});

bot.callbackQuery(/^tax_edit_manual_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var method = ctx.callbackQuery.data.replace("tax_edit_manual_", "");
  var s = await WithdrawSettings.findOne({ method: method }).lean();
  await renderTaxSlabPage(ctx, (s && s.taxSlabs) || [], "manual", method);
});

bot.callbackQuery(/^tax_add_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var data = ctx.callbackQuery.data.replace("tax_add_", "");
  var parts = data.split("_");
  var type = parts[0];
  var identifier = parts.slice(1).join("_");
  userState[ctx.from.id] = "TAX_ADD_" + type + "_" + identifier;
  await ctx.editMessageText("<b>\uD83D\uDCB0 Add Tax</b>\n\nSend Your Tax:\n\nFormat: <code>min max tax</code>\nExample: <code>10 20 4</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "tax_edit_" + type + "_" + identifier, style: "danger" }]] } }).catch(function() { });
});

bot.callbackQuery(/^tax_edit_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var data = ctx.callbackQuery.data.replace("tax_edit_", "");
  var parts = data.split("_");
  var type = parts[0];
  var idx = parseInt(parts[parts.length - 1], 10);
  var identifier = parts.slice(1, -1).join("_");
  var slabs = await getSlabsForType(type, identifier);
  if (!slabs[idx]) return;
  userState[ctx.from.id] = "TAX_EDIT_" + type + "_" + identifier + "_" + idx;
  await ctx.editMessageText("<b>\uD83D\uDCB0 Edit Tax</b>\n\nCurrent: " + RUPEE + slabs[idx].min + " \u2192 " + RUPEE + slabs[idx].max + " = " + RUPEE + slabs[idx].tax + "\n\nSend Your Tax:\n\nFormat: <code>min max tax</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "tax_edit_" + type + "_" + identifier, style: "danger" }]] } }).catch(function() { });
});

bot.callbackQuery(/^tax_del_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var data = ctx.callbackQuery.data.replace("tax_del_", "");
  var parts = data.split("_");
  var type = parts[0];
  var idx = parseInt(parts[parts.length - 1], 10);
  var identifier = parts.slice(1, -1).join("_");
  var slabs = await getSlabsForType(type, identifier);
  if (!slabs[idx]) return;
  slabs.splice(idx, 1);
  await saveSlabsForType(type, identifier, slabs);
  await renderTaxSlabPage(ctx, slabs, type, identifier);
});

const STYLE_OPTIONS = [
  { key: "success", name: "\uD83D\uDFE2 Green", emoji: "\uD83D\uDFE2" },
  { key: "danger", name: "\uD83D\uDD34 Red", emoji: "\uD83D\uDD34" },
  { key: "primary", name: "\uD83D\uDD35 Blue", emoji: "\uD83D\uDD35" },
  { key: "", name: "\u26AA No Color", emoji: "\u26AA" }
];

bot.callbackQuery("adm_keyboard_custom", async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  var text = "<b>\u2328\uFE0F Keyboard Buttons Customizing</b>\n\n\uD83D\uDC47 Manage your keyboard buttons:";
  var kb = new InlineKeyboard();
  for (var i = 0; i < layout.length; i++) {
    var btn = layout[i];
    var icon = btn.hidden ? "\uD83D\uDE48" : "\uD83D\uDC41\uFE0F";
    var styleIcon = btn.style === "success" ? "\uD83D\uDFE2" : btn.style === "danger" ? "\uD83D\uDD34" : btn.style === "primary" ? "\uD83D\uDD35" : "\u26AA";
    var label = btn.name.substring(0, 20);
    kb.row(
      { text: label, callback_data: "kbc_view_" + btn.key, style: "primary" },
      { text: "\u270F\uFE0F", callback_data: "kbc_edit_" + btn.key, style: "primary" },
      { text: styleIcon, callback_data: "kbc_style_" + btn.key, style: btn.style === "success" ? "success" : btn.style === "danger" ? "danger" : "primary" },
      { text: icon, callback_data: "kbc_toggle_" + btn.key, style: btn.hidden ? "danger" : "success" }
    );
  }
  kb.row({ text: "Reset to Default", callback_data: "kbc_reset", style: "danger" });
  kb.row({ text: "Back to Theme", callback_data: "adm_customize_theme", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
});

bot.callbackQuery(/^kbc_view_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var btnKey = ctx.callbackQuery.data.replace("kbc_view_", "");
  var layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  var btn = layout.find(function(b) { return b.key === btnKey; });
  if (!btn) return ctx.answerCallbackQuery({ text: "Not found", show_alert: true }).catch(function() { });
  var text = "<b>Button Info</b>\n\n\uD83D\uDCDD Name: " + btn.name + "\n\uD83D\uDD11 Key: <code>" + btn.key + "</code>\n\uD83D\uDCCA Row: " + btn.row + "\n\uD83C\uDFA8 Style: " + (btn.style || "No Color") + "\n\uD83D\uDC41\uFE0F Status: " + (btn.hidden ? "\uD83D\uDD34 Hidden" : "\uD83D\uDFE2 Visible");
  var kb = new InlineKeyboard()
    .row({ text: "\u270F\uFE0F Edit Name", callback_data: "kbc_edit_" + btnKey, style: "primary" })
    .row({ text: "\uD83C\uDFA8 Change Color", callback_data: "kbc_style_" + btnKey, style: "primary" })
    .row({ text: btn.hidden ? "Show" : "Hide", callback_data: "kbc_toggle_" + btnKey, style: btn.hidden ? "success" : "danger" })
    .row({ text: "Move Up", callback_data: "kbc_up_" + btnKey, style: "primary" }, { text: "Move Down", callback_data: "kbc_down_" + btnKey, style: "primary" })
    .row({ text: "Back", callback_data: "adm_keyboard_custom", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
});

bot.callbackQuery(/^kbc_edit_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var btnKey = ctx.callbackQuery.data.replace("kbc_edit_", "");
  userState[ctx.from.id] = "KBC_EDIT_NAME_" + btnKey;
  var layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  var btn = layout.find(function(b) { return b.key === btnKey; });
  await ctx.editMessageText("\u270F\uFE0F <b>Edit Button Name</b>\n\n\uD83D\uDCCC Current: " + (btn ? btn.name : "") + "\n\n\uD83D\uDCDD Send new name:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_keyboard_custom", style: "danger" }]] } }).catch(function() { });
});

bot.callbackQuery(/^kbc_style_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var btnKey = ctx.callbackQuery.data.replace("kbc_style_", "");
  var layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  var btn = layout.find(function(b) { return b.key === btnKey; });
  if (!btn) return;
  var kb = new InlineKeyboard();
  for (var i = 0; i < STYLE_OPTIONS.length; i++) {
    var opt = STYLE_OPTIONS[i];
    var check = btn.style === opt.key ? "\u2705 " : "";
    var style = opt.key === "success" ? "success" : opt.key === "danger" ? "danger" : "primary";
    kb.row({ text: check + opt.name, callback_data: "kbc_setstyle_" + btnKey + "_" + (opt.key || "none"), style: style });
  }
  kb.row({ text: "Back", callback_data: "adm_keyboard_custom", style: "primary" });
  await ctx.editMessageText("\uD83C\uDFA8 <b>Select Color for " + btn.name + "</b>", { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
});

bot.callbackQuery(/^kbc_setstyle_/, async function(ctx) {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(function() { });
  var data = ctx.callbackQuery.data.replace("kbc_setstyle_", "");
  var parts = data.split("_");
  var style = parts.pop();
  var btnKey = parts.join("_");
  var layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  var btn = layout.find(function(b) { return b.key === btnKey; });
  if (btn) {
    btn.style = style === "none" ? "" : style;
    configCache.data["keyboard_layout"] = layout;
    await setConfig("keyboard_layout", layout);
  }
  await ctx.answerCallbackQuery({ text: "\u2705 Color updated!" }).catch(function() { });
  await ctx.editMessageText("\u2705 Color updated! Use back to continue.", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_keyboard_custom", style: "primary" }]] } }).catch(function() { });
});

bot.callbackQuery(/^kbc_toggle_/, async function(ctx) {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(function() { });
  var btnKey = ctx.callbackQuery.data.replace("kbc_toggle_", "");
  var layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  var btn = layout.find(function(b) { return b.key === btnKey; });
  if (!btn) return;
  btn.hidden = !btn.hidden;
  configCache.data["keyboard_layout"] = layout;
  await setConfig("keyboard_layout", layout);
  await ctx.answerCallbackQuery({ text: btn.hidden ? "\uD83D\uDE48 Hidden" : "\uD83D\uDC41\uFE0F Visible" }).catch(function() { });
});

bot.callbackQuery(/^kbc_up_/, async function(ctx) {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(function() { });
  var btnKey = ctx.callbackQuery.data.replace("kbc_up_", "");
  var layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  var idx = layout.findIndex(function(b) { return b.key === btnKey; });
  if (idx > 0) { var temp = layout[idx].row; layout[idx].row = layout[idx - 1].row; layout[idx - 1].row = temp; configCache.data["keyboard_layout"] = layout; await setConfig("keyboard_layout", layout); }
  await ctx.answerCallbackQuery({ text: "\u2B06\uFE0F" }).catch(function() { });
});

bot.callbackQuery(/^kbc_down_/, async function(ctx) {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(function() { });
  var btnKey = ctx.callbackQuery.data.replace("kbc_down_", "");
  var layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  var idx = layout.findIndex(function(b) { return b.key === btnKey; });
  if (idx < layout.length - 1) { var temp = layout[idx].row; layout[idx].row = layout[idx + 1].row; layout[idx + 1].row = temp; configCache.data["keyboard_layout"] = layout; await setConfig("keyboard_layout", layout); }
  await ctx.answerCallbackQuery({ text: "\u2B07\uFE0F" }).catch(function() { });
});

bot.callbackQuery("kbc_reset", async function(ctx) {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(function() { });
  configCache.data["keyboard_layout"] = DEFAULT_KEYBOARD_LAYOUT;
  await setConfig("keyboard_layout", DEFAULT_KEYBOARD_LAYOUT);
  await ctx.answerCallbackQuery({ text: "Reset!" }).catch(function() { });
});

bot.callbackQuery("adm_inline_colors", async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var inlineButtons = [
    { key: "balance_statement", name: "\uD83D\uDCCA Balance Statement" },
    { key: "live_fund", name: "\uD83D\uDCB0 Live Fund" },
    { key: "refresh_balance_only", name: "\uD83D\uDD04 Refresh Balance" },
    { key: "check_join", name: "\u2705 Claim Join" }
  ];
  var styles = await getConfig("inline_button_styles", {});
  var text = "<b>\uD83C\uDFA8 Inline Button Colors</b>\n\n\uD83D\uDC47 Manage colors for each inline button:";
  var kb = new InlineKeyboard();
  for (var i = 0; i < inlineButtons.length; i++) {
    var btn = inlineButtons[i];
    var style = styles[btn.key] || "";
    var styleIcon = style === "success" ? "\uD83D\uDFE2" : style === "danger" ? "\uD83D\uDD34" : style === "primary" ? "\uD83D\uDD35" : "\u26AA";
    kb.row({ text: styleIcon + " " + btn.name, callback_data: "ibc_style_" + btn.key, style: style === "success" ? "success" : style === "danger" ? "danger" : "primary" });
  }
  kb.row({ text: "Back to Theme", callback_data: "adm_customize_theme", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
});

bot.callbackQuery(/^ibc_style_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var btnKey = ctx.callbackQuery.data.replace("ibc_style_", "");
  var styles = await getConfig("inline_button_styles", {});
  var cur = styles[btnKey] || "";
  var kb = new InlineKeyboard();
  for (var i = 0; i < STYLE_OPTIONS.length; i++) {
    var opt = STYLE_OPTIONS[i];
    var check = cur === opt.key ? "\u2705 " : "";
    var style = opt.key === "success" ? "success" : opt.key === "danger" ? "danger" : "primary";
    kb.row({ text: check + opt.name, callback_data: "ibc_set_" + btnKey + "_" + (opt.key || "none"), style: style });
  }
  kb.row({ text: "Back", callback_data: "adm_inline_colors", style: "primary" });
  await ctx.editMessageText("\uD83C\uDFA8 <b>Select Color</b>", { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
});

bot.callbackQuery(/^ibc_set_/, async function(ctx) {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(function() { });
  var data = ctx.callbackQuery.data.replace("ibc_set_", "");
  var parts = data.split("_");
  var style = parts.pop();
  var btnKey = parts.join("_");
  var styles = await getConfig("inline_button_styles", {});
  styles[btnKey] = style === "none" ? "" : style;
  await setConfig("inline_button_styles", styles);
  await ctx.answerCallbackQuery({ text: "\u2705 Color updated!" }).catch(function() { });
  await ctx.editMessageText("\u2705 Color updated! Use back to continue.", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_inline_colors", style: "primary" }]] } }).catch(function() { });
});

bot.callbackQuery("adm_panel_custom", async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var layout = configCache.data["admin_panel_layout"] || DEFAULT_ADMIN_PANEL_LAYOUT;
  var text = "<b>Admin Panel Customizing</b>\n\n\uD83D\uDC47 Manage admin panel buttons:";
  var kb = new InlineKeyboard();
  for (var i = 0; i < layout.length; i++) {
    var btn = layout[i];
    var icon = btn.hidden ? "\uD83D\uDE48" : "\uD83D\uDC41\uFE0F";
    var styleIcon = btn.style === "success" ? "\uD83D\uDFE2" : btn.style === "danger" ? "\uD83D\uDD34" : btn.style === "primary" ? "\uD83D\uDD35" : "\u26AA";
    var label = btn.name.substring(0, 20);
    kb.row(
      { text: label, callback_data: "apc_view_" + btn.key, style: "primary" },
      { text: styleIcon, callback_data: "apc_style_" + btn.key, style: btn.style === "success" ? "success" : btn.style === "danger" ? "danger" : "primary" },
      { text: icon, callback_data: "apc_toggle_" + btn.key, style: btn.hidden ? "danger" : "success" }
    );
  }
  kb.row({ text: "Reset to Default", callback_data: "apc_reset", style: "danger" });
  kb.row({ text: "Back to Theme", callback_data: "adm_customize_theme", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
});

bot.callbackQuery(/^apc_view_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var btnKey = ctx.callbackQuery.data.replace("apc_view_", "");
  var layout = configCache.data["admin_panel_layout"] || DEFAULT_ADMIN_PANEL_LAYOUT;
  var btn = layout.find(function(b) { return b.key === btnKey; });
  if (!btn) return ctx.answerCallbackQuery({ text: "Not found", show_alert: true }).catch(function() { });
  var text = "<b>Button Info</b>\n\n\uD83D\uDCDD Name: " + btn.name + "\n\uD83D\uDD11 Key: <code>" + btn.key + "</code>\n\uD83C\uDFA8 Style: " + (btn.style || "No Color") + "\n\uD83D\uDC41\uFE0F Status: " + (btn.hidden ? "\uD83D\uDD34 Hidden" : "\uD83D\uDFE2 Visible");
  var kb = new InlineKeyboard()
    .row({ text: "\u270F\uFE0F Edit Name", callback_data: "apc_edit_" + btnKey, style: "primary" })
    .row({ text: "\uD83C\uDFA8 Change Color", callback_data: "apc_style_" + btnKey, style: "primary" })
    .row({ text: btn.hidden ? "Show" : "Hide", callback_data: "apc_toggle_" + btnKey, style: btn.hidden ? "success" : "danger" })
    .row({ text: "Back", callback_data: "adm_panel_custom", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
});

bot.callbackQuery(/^apc_edit_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var btnKey = ctx.callbackQuery.data.replace("apc_edit_", "");
  userState[ctx.from.id] = "APC_EDIT_NAME_" + btnKey;
  await ctx.editMessageText("\u270F\uFE0F <b>Edit Button Name</b>\n\n\uD83D\uDCDD Send new name:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_panel_custom", style: "danger" }]] } }).catch(function() { });
});

bot.callbackQuery(/^apc_style_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var btnKey = ctx.callbackQuery.data.replace("apc_style_", "");
  var layout = configCache.data["admin_panel_layout"] || DEFAULT_ADMIN_PANEL_LAYOUT;
  var btn = layout.find(function(b) { return b.key === btnKey; });
  if (!btn) return;
  var kb = new InlineKeyboard();
  for (var i = 0; i < STYLE_OPTIONS.length; i++) {
    var opt = STYLE_OPTIONS[i];
    var check = btn.style === opt.key ? "\u2705 " : "";
    var style = opt.key === "success" ? "success" : opt.key === "danger" ? "danger" : "primary";
    kb.row({ text: check + opt.name, callback_data: "apc_setstyle_" + btnKey + "_" + (opt.key || "none"), style: style });
  }
  kb.row({ text: "Back", callback_data: "adm_panel_custom", style: "primary" });
  await ctx.editMessageText("\uD83C\uDFA8 <b>Select Color for " + btn.name + "</b>", { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
});

bot.callbackQuery(/^apc_setstyle_/, async function(ctx) {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(function() { });
  var data = ctx.callbackQuery.data.replace("apc_setstyle_", "");
  var parts = data.split("_");
  var style = parts.pop();
  var btnKey = parts.join("_");
  var layout = configCache.data["admin_panel_layout"] || DEFAULT_ADMIN_PANEL_LAYOUT;
  var btn = layout.find(function(b) { return b.key === btnKey; });
  if (btn) { btn.style = style === "none" ? "" : style; configCache.data["admin_panel_layout"] = layout; await setConfig("admin_panel_layout", layout); }
  await ctx.answerCallbackQuery({ text: "\u2705 Color updated!" }).catch(function() { });
  await ctx.editMessageText("\u2705 Color updated!", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_panel_custom", style: "primary" }]] } }).catch(function() { });
});

bot.callbackQuery(/^apc_toggle_/, async function(ctx) {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(function() { });
  var btnKey = ctx.callbackQuery.data.replace("apc_toggle_", "");
  var layout = configCache.data["admin_panel_layout"] || DEFAULT_ADMIN_PANEL_LAYOUT;
  var btn = layout.find(function(b) { return b.key === btnKey; });
  if (!btn) return;
  btn.hidden = !btn.hidden;
  configCache.data["admin_panel_layout"] = layout;
  await setConfig("admin_panel_layout", layout);
  await ctx.answerCallbackQuery({ text: btn.hidden ? "\uD83D\uDE48 Hidden" : "\uD83D\uDC41\uFE0F Visible" }).catch(function() { });
});

bot.callbackQuery("apc_reset", async function(ctx) {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(function() { });
  configCache.data["admin_panel_layout"] = DEFAULT_ADMIN_PANEL_LAYOUT;
  await setConfig("admin_panel_layout", DEFAULT_ADMIN_PANEL_LAYOUT);
  await ctx.answerCallbackQuery({ text: "Reset!" }).catch(function() { });
});

bot.callbackQuery("adm_user_update", async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "USER_UPDATE_BROADCAST";
  await ctx.editMessageText("\uD83D\uDCE2 <b>User Update Broadcast</b>\n\nSend your update message to send to all users:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "admin", style: "danger" }]] } }).catch(function() { });
});

async function handleUserUpdateBroadcast(ctx, text, userId) {
  delete userState[userId];
  var html = entitiesToHtml(text, ctx.message.entities || []);
  var users = await User.find({}).lean();
  var sent = 0, failed = 0;
  for (var ui = 0; ui < users.length; ui++) {
    try {
      await bot.api.sendMessage(users[ui].userId, html, { parse_mode: "HTML" }).catch(function() { throw new Error("x"); });
      sent++;
      await new Promise(function(r) { setTimeout(r, 40); });
    } catch (e) { failed++; }
  }
  await ctx.reply("<b>User Update Complete!</b>\n\n<blockquote>\u2705 Sent: " + sent + "\n\u274C Failed: " + failed + "</blockquote>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admin", style: "primary" }]] } }).catch(function() { });
  return true;
}

bot.callbackQuery("adm_auto_bank", async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var banks = await AutoBank.find({}).sort({ createdAt: 1 }).lean();
  var total = banks.length;
  var active = banks.filter(function(b) { return b.status === "active"; }).length;
  var bodyText = "Total: " + total + " | \uD83D\uDFE2 ON: " + active + "\n\n";
  if (total === 0) bodyText += "No Auto Bank gateways configured.";
  else banks.forEach(function(b, i) { bodyText += (i + 1) + ". \uD83C\uDFE6 " + b.name + "\n   " + (b.status === "active" ? "\uD83D\uDFE2 ON" : "\uD83D\uDD34 OFF") + "\n\n"; });
  var kb = new InlineKeyboard().row({ text: "\u2795 Add New Auto Bank", callback_data: "auto_bank_add", style: "success" });
  for (var i = 0; i < banks.length; i++) {
    var b = banks[i];
    var icon = b.status === "active" ? "\uD83D\uDFE2" : "\uD83D\uDD34";
    kb.row({ text: icon + " " + b.name, callback_data: "auto_bank_view_" + b.gatewayId, style: "primary" });
  }
  kb.row({ text: "Back", callback_data: "adm_gateway_menu", style: "primary" });
  await ctx.editMessageText("\uD83C\uDFE6 <b>Auto Bank</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
});

bot.callbackQuery("auto_bank_add", async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "AUTO_BANK_ADD";
  await ctx.editMessageText("\u2795 <b>Add Auto Bank</b>\n\nFormat:\n<code>NAME::URL</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_auto_bank", style: "danger" }]] } }).catch(function() { });
});

bot.callbackQuery(/^auto_bank_view_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_bank_view_", "");
  var bank = await AutoBank.findOne({ gatewayId: gwId }).lean();
  if (!bank) return;
  var statusIcon = bank.status === "active" ? "\uD83D\uDFE2 ON" : "\uD83D\uDD34 OFF";
  var bodyText = "Status: " + statusIcon + "\nMin: " + RUPEE + (bank.minAmount || 0) + " | Max: " + RUPEE + (bank.maxAmount || 0) + "\nTax Slabs: " + (bank.taxSlabs || []).length + "\nPayout: " + (bank.payoutChannel || "Default") + "\n\nURL:\n<code>" + bank.apiUrl + "</code>";
  var kb = new InlineKeyboard()
    .row({ text: bank.status === "active" ? "\uD83D\uDD34 Turn OFF" : "\uD83D\uDFE2 Turn ON", callback_data: "auto_bank_toggle_" + gwId, style: bank.status === "active" ? "danger" : "success" })
    .row({ text: "\uD83D\uDCB0 Set Tax Slabs", callback_data: "tax_edit_bank_" + gwId, style: "success" })
    .row({ text: "\uD83D\uDCE2 Set Payout Channel", callback_data: "auto_bank_set_payout_" + gwId, style: "primary" })
    .row({ text: "\uD83D\uDDD1\uFE0F Delete", callback_data: "auto_bank_del_" + gwId, style: "danger" })
    .row({ text: "Back", callback_data: "adm_auto_bank", style: "primary" });
  await ctx.editMessageText("\uD83C\uDFE6 <b>" + bank.name + "</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
});

bot.callbackQuery(/^auto_bank_toggle_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_bank_toggle_", "");
  var bank = await AutoBank.findOne({ gatewayId: gwId });
  if (bank) { bank.status = bank.status === "active" ? "off" : "active"; await bank.save(); }
  await ctx.answerCallbackQuery({ text: "Toggled" }).catch(function() { });
});

bot.callbackQuery(/^auto_bank_del_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_bank_del_", "");
  await AutoBank.deleteOne({ gatewayId: gwId });
  await ctx.answerCallbackQuery({ text: "Deleted!" }).catch(function() { });
});

bot.callbackQuery(/^auto_bank_set_payout_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_bank_set_payout_", "");
  userState[ctx.from.id] = "AUTO_BANK_PAYOUT_" + gwId;
  await ctx.editMessageText("\uD83D\uDCE2 Send Payout Channel:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "auto_bank_view_" + gwId, style: "danger" }]] } }).catch(function() { });
});

async function handleAutoBankInput(ctx, text, userId, state) {
  if (state === "AUTO_BANK_ADD") {
    delete userState[userId];
    var parts = text.trim().split("::").map(function(p) { return p.trim(); });
    var name, url;
    if (parts.length === 2) { name = parts[0].toUpperCase().replace(/\s+/g, "_"); url = parts[1]; }
    else { name = "BANK_" + Date.now().toString().slice(-6); url = text.trim(); }
    if (url.indexOf("http") !== 0) { await ctx.reply("\u274C Invalid URL!").catch(function() { }); return true; }
    var gwId = "ABG" + Date.now().toString().slice(-8);
    await AutoBank.create({ gatewayId: gwId, name: name, apiUrl: url, status: "active", minAmount: 0, maxAmount: 0, taxSlabs: [] });
    await ctx.reply("\u2705 <b>Auto Bank Added!</b>\n\n\uD83C\uDF10 " + name + "\n\uD83D\uDFE2 ON\nURL:\n<code>" + url + "</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "View", callback_data: "auto_bank_view_" + gwId, style: "primary" }], [{ text: "Back", callback_data: "adm_auto_bank", style: "primary" }]] } }).catch(function() { });
    return true;
  }
  if (state.indexOf("AUTO_BANK_PAYOUT_") === 0) {
    var gwId2 = state.replace("AUTO_BANK_PAYOUT_", "");
    delete userState[userId];
    try { await ctx.api.getChat(text.trim()); } catch (e) { await ctx.reply("\u274C Cannot access channel!").catch(function() { }); return true; }
    await AutoBank.updateOne({ gatewayId: gwId2 }, { payoutChannel: text.trim() });
    await ctx.reply("\u2705 Payout Channel set!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "auto_bank_view_" + gwId2, style: "primary" }]] } }).catch(function() { });
    return true;
  }
  return false;
}

async function handleAdminTaxInput(ctx, text, userId, state) {
  if (state.indexOf("TAX_ADD_") === 0) {
    var data = state.replace("TAX_ADD_", "");
    var parts = data.split("_");
    var type = parts[0];
    var identifier = parts.slice(1).join("_");
    delete userState[userId];
    var slab = parseTaxSlabInput(text);
    if (!slab) { await ctx.reply("\u274C Invalid format!\n\nUse: <code>min max tax</code>\nExample: <code>10 20 4</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Try Again", callback_data: "tax_add_" + type + "_" + identifier, style: "primary" }], [{ text: "Back", callback_data: "tax_edit_" + type + "_" + identifier, style: "primary" }]] } }).catch(function() { }); return true; }
    var slabs = await getSlabsForType(type, identifier);
    slabs.push(slab);
    await saveSlabsForType(type, identifier, slabs);
    await renderTaxSlabPage(ctx, slabs, type, identifier);
    return true;
  }
  if (state.indexOf("TAX_EDIT_") === 0) {
    var data2 = state.replace("TAX_EDIT_", "");
    var parts2 = data2.split("_");
    var type2 = parts2[0];
    var idx2 = parseInt(parts2[parts2.length - 1], 10);
    var identifier2 = parts2.slice(1, -1).join("_");
    delete userState[userId];
    var slab2 = parseTaxSlabInput(text);
    if (!slab2) { await ctx.reply("\u274C Invalid format!\n\nUse: <code>min max tax</code>", { parse_mode: "HTML" }).catch(function() { }); return true; }
    var slabs2 = await getSlabsForType(type2, identifier2);
    if (!slabs2[idx2]) return true;
    slabs2[idx2] = slab2;
    await saveSlabsForType(type2, identifier2, slabs2);
    await renderTaxSlabPage(ctx, slabs2, type2, identifier2);
    return true;
  }
  return false;
}

bot.callbackQuery("adm_gateway_menu", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderWithdrawalStep(ctx);
});

async function renderWithdrawalStep(ctx) {
  var text = "🚀 <b>Withdrawal Step</b>\n\nChoose withdrawal method:";
  var kb = new InlineKeyboard()
    .row({ text: "🌐 Gateway", callback_data: "adm_gateway_list", style: "primary" })
    .row({ text: "⚡ Auto UPI", callback_data: "adm_auto_upi", style: "primary" })
    .row({ text: "🏦 Auto Bank Gateway", callback_data: "adm_auto_bank", style: "primary" })
    .row({ text: "Back to Admin", callback_data: "admin", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("adm_gateway_list", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderGatewayMenu(ctx);
});

async function renderGatewayMenu(ctx) {
  var gateways = await Gateway.find({}).sort({ createdAt: -1 }).lean();
  var total = gateways.length;
  var active = gateways.filter(function(g) { return g.isActive; }).length;
  var bodyText = "Total: " + total + " | 🟢 ON: " + active + "\n\n";
  if (total === 0) bodyText += "No gateways configured.";
  else gateways.forEach(function(g, i) { bodyText += (i + 1) + ". 🌐 " + g.name + "\n   " + (g.isActive ? "🟢 ON" : "🔴 OFF") + "\n   🔗 " + (g.url_template || g.url).substring(0, 35) + "...\n\n"; });
  var kb = new InlineKeyboard().row({ text: "Add New Gateway", callback_data: "gw_add_new", style: "success" });
  for (var i = 0; i < gateways.length; i++) { var icon = gateways[i].isActive ? "🟢" : "🔴"; kb.row({ text: icon + " " + gateways[i].name, callback_data: "gw_view_" + gateways[i].name, style: "primary" }); }
  kb.row({ text: "Back", callback_data: "adm_gateway_menu", style: "primary" });
  await ctx.editMessageText("🌐 <b>Gateways</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("gw_add_new", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "GW_WAIT_NAME_V2";
  await ctx.editMessageText("🏦 Add New Gateway\n\n📝 Send Gateway Name:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_gateway_list", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^gw_view_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var name = ctx.callbackQuery.data.replace("gw_view_", "");
  var gw = await Gateway.findOne({ name }).lean();
  if (!gw) return ctx.answerCallbackQuery({ text: "Not found", show_alert: true }).catch(() => { });
  var urlShow = gw.url_template || gw.url || "";
  var bodyText = "URL:\n<code>" + urlShow + "</code>\n\nStatus: " + (gw.isActive ? "🟢 ON" : "🔴 OFF") + "\nMin: " + RUPEE + (gw.minAmount || 0) + "\nMax: " + RUPEE + (gw.maxAmount || 0) + "\nTax Slabs: " + (gw.taxSlabs || []).length + "\nPayout: " + (gw.payoutChannel || "Default") + "\n\nCreated: " + formatDateTime(gw.createdAt);
  var kb = new InlineKeyboard()
    .row({ text: "Edit Settings", callback_data: "gw_edit_" + gw.name, style: "primary" })
    .row({ text: "Set Tax Slabs", callback_data: "tax_edit_gw_" + gw.name, style: "success" })
    .row({ text: "Set Payout Channel", callback_data: "gw_set_payout_" + gw.name, style: "primary" })
    .row({ text: gw.isActive ? "Turn OFF" : "Turn ON", callback_data: "gw_toggle_" + gw.name, style: gw.isActive ? "danger" : "success" })
    .row({ text: "Edit URL", callback_data: "gw_edit_url_" + gw.name, style: "primary" })
    .row({ text: "Delete Gateway", callback_data: "gw_del_" + gw.name, style: "danger" })
    .row({ text: "Back", callback_data: "adm_gateway_list", style: "primary" });
  await ctx.editMessageText("<b>Gateway: " + gw.name + "</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^gw_toggle_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var name = ctx.callbackQuery.data.replace("gw_toggle_", "");
  var gw = await Gateway.findOne({ name });
  if (!gw) return;
  gw.isActive = !gw.isActive;
  gw.updatedAt = new Date();
  await gw.save();
  await ctx.answerCallbackQuery({ text: gw.isActive ? "ON" : "OFF" }).catch(() => { });
});

bot.callbackQuery(/^gw_edit_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var name = ctx.callbackQuery.data.replace("gw_edit_", "");
  var gw = await Gateway.findOne({ name });
  if (!gw) return;
  var text = "<b>" + name + " Settings</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nStatus: " + (gw.isActive ? "ON" : "OFF") + "\nMin: " + RUPEE + (gw.minAmount || 0) + "\nMax: " + RUPEE + (gw.maxAmount || 0) + "\nTax Slabs: " + (gw.taxSlabs || []).length + "\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
  var kb = new InlineKeyboard()
    .row({ text: "Set Min", callback_data: "gw_min_" + name, style: "primary" })
    .row({ text: "Set Max", callback_data: "gw_max_" + name, style: "primary" })
    .row({ text: "Set Tax Slabs", callback_data: "tax_edit_gw_" + name, style: "success" })
    .row({ text: gw.isActive ? "Turn OFF" : "Turn ON", callback_data: "gw_toggle_" + name, style: gw.isActive ? "danger" : "success" })
    .row({ text: "Back", callback_data: "gw_view_" + name, style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^gw_min_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var name = ctx.callbackQuery.data.replace("gw_min_", "");
  userState[ctx.from.id] = "GW_MIN_" + name;
  await ctx.editMessageText("Set Min Amount\n\nSend minimum amount:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "gw_edit_" + name, style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery(/^gw_max_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var name = ctx.callbackQuery.data.replace("gw_max_", "");
  userState[ctx.from.id] = "GW_MAX_" + name;
  await ctx.editMessageText("Set Max Amount\n\nSend maximum amount:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "gw_edit_" + name, style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery(/^gw_edit_url_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var name = ctx.callbackQuery.data.replace("gw_edit_url_", "");
  userState[ctx.from.id] = "GW_EDIT_URL_" + name;
  var gw = await Gateway.findOne({ name }).lean();
  await ctx.editMessageText("<b>Edit Gateway URL</b>\n\n📛 " + name + "\n\nCurrent:\n<code>" + gw.url + "</code>\n\nSend new URL template:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "gw_view_" + name, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^gw_set_payout_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var name = ctx.callbackQuery.data.replace("gw_set_payout_", "");
  userState[ctx.from.id] = "GW_PAYOUT_" + name;
  await ctx.editMessageText("📢 Send Payout Channel for " + name + ":", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "gw_view_" + name, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^gw_del_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var name = ctx.callbackQuery.data.replace("gw_del_", "");
  await Gateway.deleteOne({ name });
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Gateway Deleted", name, 0, null);
  await ctx.answerCallbackQuery({ text: "Deleted!" }).catch(() => { });
  await renderGatewayMenu(ctx);
});

bot.callbackQuery("adm_auto_upi", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderAutoUpiMenu(ctx);
});

async function renderAutoUpiMenu(ctx) {
  var gateways = await AutoUpi.find({}).sort({ createdAt: 1 }).lean();
  var total = gateways.length;
  var active = gateways.filter(function(g) { return g.status === "active"; }).length;
  var bodyText = "Total: " + total + " | 🟢 ON: " + active + "\n\n";
  if (total === 0) bodyText += "No Auto UPI gateways configured.";
  else gateways.forEach(function(g, i) { bodyText += (i + 1) + ". 🌐 " + g.name + "\n   " + (g.status === "active" ? "🟢 ON" : "🔴 OFF") + " | " + g.method + "\n\n"; });
  var kb = new InlineKeyboard().row({ text: "➕ Add New Auto UPI", callback_data: "auto_upi_add", style: "success" });
  for (var i = 0; i < gateways.length; i++) {
    var icon = gateways[i].status === "active" ? "🟢" : "🔴";
    kb.row({ text: icon + " " + gateways[i].name, callback_data: "auto_upi_view_" + gateways[i].gatewayId, style: "primary" });
  }
  kb.row({ text: "Back", callback_data: "adm_gateway_menu", style: "primary" });
  await ctx.editMessageText("⚡ <b>Auto UPI</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("auto_upi_add", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await ctx.editMessageText("➕ <b>Add New Auto UPI</b>\n\nChoose model:", {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .row({ text: "📝 Simple Model", callback_data: "auto_upi_simple", style: "primary" })
      .row({ text: "⚙️ Advanced Model", callback_data: "auto_upi_advanced", style: "primary" })
      .row({ text: "Back", callback_data: "adm_auto_upi", style: "primary" })
  }).catch(() => { });
});

bot.callbackQuery("auto_upi_simple", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "AUTO_UPI_SIMPLE_NAME";
  await ctx.editMessageText("📝 <b>Simple Model</b>\n\nStep 1 of 2\n\n📝 Send Gateway Name:\n\nExample:\nCASHFREE\nPHONEPE", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_auto_upi", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("auto_upi_advanced", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "AUTO_UPI_ADVANCED_INPUT";
  await ctx.editMessageText("⚙️ <b>Advanced Model</b>\n\n📝 Send in single line:\n\nFormat:\n<code>NAME::METHOD::URL::TOKEN</code>\n\nExamples:\n<code>CASHFREE::GET::https://api.cashfree.com/payout::KEY123</code>\n<code>PHONEPE::POST::https://api.phonepe.com/payout</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_auto_upi", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_view_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_upi_view_", "");
  var gw = await AutoUpi.findOne({ gatewayId: gwId }).lean();
  if (!gw) return ctx.answerCallbackQuery({ text: "Not found", show_alert: true }).catch(() => { });
  var statusIcon = gw.status === "active" ? "🟢 ON" : "🔴 OFF";
  var bodyText = "Status: " + statusIcon + "\nMethod: " + (gw.method || "GET") + "\nMin: " + RUPEE + (gw.minAmount || 0) + " | Max: " + RUPEE + (gw.maxAmount || 0) + "\nTax Slabs: " + (gw.taxSlabs || []).length + "\nPayout: " + (gw.payoutChannel || "Default") + "\n\nURL:\n<code>" + gw.apiUrl + "</code>";
  var kb = new InlineKeyboard()
    .row({ text: "✏️ Edit Settings", callback_data: "auto_upi_edit_" + gw.gatewayId, style: "primary" })
    .row({ text: "Set Tax Slabs", callback_data: "tax_edit_upi_" + gw.gatewayId, style: "success" })
    .row({ text: "Set Payout Channel", callback_data: "auto_upi_set_payout_" + gw.gatewayId, style: "primary" })
    .row({ text: gw.status === "active" ? "🔴 Turn OFF" : "🟢 Turn ON", callback_data: "auto_upi_toggle_" + gw.gatewayId, style: gw.status === "active" ? "danger" : "success" })
    .row({ text: "🗑️ Delete", callback_data: "auto_upi_del_" + gw.gatewayId, style: "danger" })
    .row({ text: "Back", callback_data: "adm_auto_upi", style: "primary" });
  await ctx.editMessageText("🌐 <b>" + gw.name + "</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_edit_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_upi_edit_", "");
  var gw = await AutoUpi.findOne({ gatewayId: gwId }).lean();
  if (!gw) return;
  var kb = new InlineKeyboard()
    .row({ text: "📝 Edit Name", callback_data: "auto_upi_edit_name_" + gwId, style: "primary" })
    .row({ text: "🌐 Edit URL", callback_data: "auto_upi_edit_url_" + gwId, style: "primary" })
    .row({ text: "⚙️ Edit Method", callback_data: "auto_upi_edit_method_" + gwId, style: "primary" })
    .row({ text: "💰 Set Min Amount", callback_data: "auto_upi_set_min_" + gwId, style: "primary" })
    .row({ text: "💰 Set Max Amount", callback_data: "auto_upi_set_max_" + gwId, style: "primary" })
    .row({ text: "Back", callback_data: "auto_upi_view_" + gwId, style: "primary" });
  await ctx.editMessageText("✏️ <b>Edit " + gw.name + "</b>\n\nChoose what to edit:", { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_edit_name_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_upi_edit_name_", "");
  userState[ctx.from.id] = "AUTO_UPI_EDIT_NAME_" + gwId;
  await ctx.editMessageText("📝 Send new name:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "auto_upi_edit_" + gwId, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_edit_url_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_upi_edit_url_", "");
  userState[ctx.from.id] = "AUTO_UPI_EDIT_URL_" + gwId;
  await ctx.editMessageText("🌐 Send new URL:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "auto_upi_edit_" + gwId, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_edit_method_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_upi_edit_method_", "");
  await ctx.editMessageText("⚙️ Choose method:", {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .row({ text: "GET", callback_data: "auto_upi_set_method_" + gwId + "_GET", style: "primary" })
      .row({ text: "POST", callback_data: "auto_upi_set_method_" + gwId + "_POST", style: "primary" })
      .row({ text: "Cancel", callback_data: "auto_upi_edit_" + gwId, style: "danger" })
  }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_set_method_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var data = ctx.callbackQuery.data.replace("auto_upi_set_method_", "");
  var parts = data.split("_");
  var method = parts.pop();
  var gwId = parts.join("_");
  await AutoUpi.updateOne({ gatewayId: gwId }, { method });
  await ctx.editMessageText("✅ Method set to " + method, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "auto_upi_view_" + gwId, style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_set_min_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_upi_set_min_", "");
  userState[ctx.from.id] = "AUTO_UPI_MIN_" + gwId;
  await ctx.editMessageText("💰 Send minimum amount:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "auto_upi_edit_" + gwId, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_set_max_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_upi_set_max_", "");
  userState[ctx.from.id] = "AUTO_UPI_MAX_" + gwId;
  await ctx.editMessageText("💰 Send maximum amount:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "auto_upi_edit_" + gwId, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_set_payout_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_upi_set_payout_", "");
  userState[ctx.from.id] = "AUTO_UPI_PAYOUT_" + gwId;
  await ctx.editMessageText("📢 Send Payout Channel:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "auto_upi_view_" + gwId, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_toggle_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_upi_toggle_", "");
  var gw = await AutoUpi.findOne({ gatewayId: gwId });
  if (!gw) return;
  gw.status = gw.status === "active" ? "off" : "active";
  await gw.save();
  await ctx.answerCallbackQuery({ text: gw.status === "active" ? "🟢 ON" : "🔴 OFF" }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_del_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_upi_del_", "");
  await AutoUpi.deleteOne({ gatewayId: gwId });
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Auto UPI Deleted", gwId, 0, null);
  await ctx.answerCallbackQuery({ text: "🗑️ Deleted!" }).catch(() => { });
  await renderAutoUpiMenu(ctx);
});

bot.callbackQuery("adm_manage_withdraw", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderManageWithdraw(ctx);
});

async function renderManageWithdraw(ctx) {
  var methods = ["upi", "bank", "amazon", "redeem"];
  for (var m = 0; m < methods.length; m++) {
    var s = await WithdrawSettings.findOne({ method: methods[m] });
    if (!s) await WithdrawSettings.create({ method: methods[m], isActive: false, minAmount: 0, maxAmount: 0, taxPercent: 0, taxSlabs: [] });
  }
  var settings = await WithdrawSettings.find({}).lean();
  var gateways = await Gateway.find({}).sort({ createdAt: 1 }).lean();
  var autoUpis = await AutoUpi.find({}).sort({ createdAt: 1 }).lean();
  var autoBanks = await AutoBank.find({}).sort({ createdAt: 1 }).lean();
  var text = "<b>Manage Withdraw</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<b>Manual Withdraw</b>\n\n";
  for (var i = 0; i < methods.length; i++) {
    var s2 = settings.find(function(x) { return x.method === methods[i]; });
    if (!s2) continue;
    text += methods[i].toUpperCase() + " (" + RUPEE + s2.minAmount + " - " + RUPEE + s2.maxAmount + ") " + (s2.isActive ? "🟢" : "🔴") + "\n";
  }
  if (gateways.length > 0) {
    text += "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<b>Auto Gateway</b>\n\n";
    for (var gi = 0; gi < gateways.length; gi++) text += gateways[gi].name + " (" + RUPEE + (gateways[gi].minAmount || 0) + " - " + RUPEE + (gateways[gi].maxAmount || 0) + ") " + (gateways[gi].isActive ? "🟢" : "🔴") + "\n";
  }
  if (autoUpis.length > 0) {
    text += "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<b>Auto UPI</b>\n\n";
    for (var au = 0; au < autoUpis.length; au++) text += autoUpis[au].name + " (" + RUPEE + (autoUpis[au].minAmount || 0) + " - " + RUPEE + (autoUpis[au].maxAmount || 0) + ") " + (autoUpis[au].status === "active" ? "🟢" : "🔴") + "\n";
  }
  if (autoBanks.length > 0) {
    text += "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<b>Auto Bank</b>\n\n";
    for (var ab = 0; ab < autoBanks.length; ab++) text += autoBanks[ab].name + " (" + RUPEE + (autoBanks[ab].minAmount || 0) + " - " + RUPEE + (autoBanks[ab].maxAmount || 0) + ") " + (autoBanks[ab].status === "active" ? "🟢" : "🔴") + "\n";
  }
  text += "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nClick to edit:";
  var kb = new InlineKeyboard();
  for (var mi = 0; mi < methods.length; mi++) kb.row({ text: methods[mi].toUpperCase(), callback_data: "admwd_edit_" + methods[mi], style: "primary" });
  for (var g = 0; g < gateways.length; g++) kb.row({ text: gateways[g].name.toUpperCase(), callback_data: "gw_edit_" + gateways[g].name, style: "primary" });
  for (var a = 0; a < autoUpis.length; a++) kb.row({ text: "⚡ " + autoUpis[a].name, callback_data: "auto_upi_edit_" + autoUpis[a].gatewayId, style: "primary" });
  for (var b = 0; b < autoBanks.length; b++) kb.row({ text: "🏦 " + autoBanks[b].name, callback_data: "auto_bank_view_" + autoBanks[b].gatewayId, style: "primary" });
  kb.row({ text: "Back", callback_data: "adm_customize_theme", style: "primary" });
  if (ctx.callbackQuery) await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
  else await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery(/^admwd_edit_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var method = ctx.callbackQuery.data.replace("admwd_edit_", "");
  var s = await WithdrawSettings.findOne({ method: method });
  if (!s) s = await WithdrawSettings.create({ method: method, isActive: false, minAmount: 0, maxAmount: 0, taxPercent: 0, taxSlabs: [] });
  var text = "<b>" + method.toUpperCase() + " Settings</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nStatus: " + (s.isActive ? "🟢 ON" : "🔴 OFF") + "\nMin: " + RUPEE + s.minAmount + "\nMax: " + RUPEE + s.maxAmount + "\nTax Slabs: " + (s.taxSlabs || []).length + "\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
  var kb = new InlineKeyboard()
    .row({ text: "Set Min", callback_data: "admwd_min_" + method, style: "primary" })
    .row({ text: "Set Max", callback_data: "admwd_max_" + method, style: "primary" })
    .row({ text: "Set Tax Slabs", callback_data: "tax_edit_manual_" + method, style: "success" })
    .row({ text: s.isActive ? "Turn OFF" : "Turn ON", callback_data: "admwd_toggle_" + method, style: s.isActive ? "danger" : "success" })
    .row({ text: "Back", callback_data: "adm_manage_withdraw", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^admwd_toggle_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var method = ctx.callbackQuery.data.replace("admwd_toggle_", "");
  var s = await WithdrawSettings.findOne({ method: method });
  if (!s) s = await WithdrawSettings.create({ method: method, isActive: false });
  else { s.isActive = !s.isActive; s.updatedAt = new Date(); await s.save(); }
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Method Toggled", method + " -> " + (s.isActive ? "ON" : "OFF"), 0, null);
  await ctx.answerCallbackQuery({ text: s.isActive ? "ON" : "OFF" }).catch(() => { });
});

bot.callbackQuery(/^admwd_min_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var method = ctx.callbackQuery.data.replace("admwd_min_", "");
  userState[ctx.from.id] = "ADMWD_MIN_" + method;
  await ctx.editMessageText("Set Min Amount\n\nSend minimum amount:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admwd_edit_" + method, style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery(/^admwd_max_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var method = ctx.callbackQuery.data.replace("admwd_max_", "");
  userState[ctx.from.id] = "ADMWD_MAX_" + method;
  await ctx.editMessageText("Set Max Amount\n\nSend maximum amount:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admwd_edit_" + method, style: "primary" }]] } }).catch(() => { });
});

async function renderTaskManager(ctx) {
  var tasks = await Task.find({ isComplete: true }).sort({ createdAt: -1 }).lean();
  var text = "💡 <b>Here You Can Manage Your Tasks</b>\n\nSelect a task to view, edit, or delete it.";
  var kb = new InlineKeyboard();
  if (tasks.length === 0) kb.row({ text: "No Tasks", callback_data: "noop", style: "danger" });
  else {
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      var shortName = t.title.length > 12 ? t.title.substring(0, 12) + ".." : t.title;
      var statusIcon = t.isActive !== false ? "🟢" : "🔴";
      kb.row(
        { text: "📄 " + shortName, callback_data: "view_task_" + t.taskId, style: "primary" },
        { text: "✏️", callback_data: "edit_task_" + t.taskId, style: "primary" },
        { text: "🗑️", callback_data: "del_task_" + t.taskId, style: "danger" },
        { text: statusIcon, callback_data: "toggle_task_" + t.taskId, style: t.isActive !== false ? "success" : "danger" }
      );
    }
  }
  kb.row({ text: "➕ Add New Task", callback_data: "adm_create_task", style: "success" }, { text: "Search Task", callback_data: "adm_search_task", style: "primary" });
  kb.row({ text: "➕ Add Channel For Task Alert", callback_data: "adm_task_alert_channel", style: "primary" });
  kb.row({ text: "⬅️ Back", callback_data: "admin", style: "primary" });
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
  var current = await getConfig("default_task_alert_channel", "Not Set");
  await ctx.editMessageText("➕ <b>Add Channel For Task Alert</b>\n\n📌 Current: <code>" + current + "</code>\n\n📝 Send Channel Username:\n\nExample:\n<code>@yourchannel</code>\n<code>-1001234567890</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_tasks_manager", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^view_task_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var tId = ctx.callbackQuery.data.replace("view_task_", "");
  var task = await Task.findOne({ taskId: tId }).lean();
  if (!task) return;
  var bodyText = "Task ID: " + task.taskId + "\nName: " + task.title + "\nReward: " + RUPEE + task.reward + "\nLink: " + task.link + "\nType: " + (task.taskType || "photo") + "\nAlert Channel: " + (task.alertChannel || "Not Set") + "\nStatus: " + (task.isActive !== false ? "🟢 ON" : "🔴 OFF") + "\nCompleted: " + task.completedUsers.length + " users";
  if (task.expiresAt) bodyText += "\nExpires: " + formatDateTime(task.expiresAt);
  var kb = new InlineKeyboard()
    .row({ text: "Edit Title", callback_data: "task_edit_title_" + task.taskId, style: "primary" })
    .row({ text: "Edit Reward", callback_data: "task_edit_reward_" + task.taskId, style: "primary" })
    .row({ text: "Edit Link", callback_data: "task_edit_link_" + task.taskId, style: "primary" })
    .row({ text: "Edit Alert Channel", callback_data: "task_edit_channel_" + task.taskId, style: "primary" })
    .row({ text: "Type: " + (task.taskType || "photo").toUpperCase(), callback_data: "task_edit_type_" + task.taskId, style: "primary" })
    .row({ text: "Delete Task", callback_data: "del_task_" + task.taskId, style: "danger" })
    .row({ text: "Back", callback_data: "adm_tasks_manager", style: "primary" });
  await ctx.editMessageText("<b>Task Details</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^del_task_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var tId = ctx.callbackQuery.data.replace("del_task_", "");
  var task = await Task.findOne({ taskId: tId }).lean();
  if (!task) { await ctx.answerCallbackQuery({ text: "Already deleted", show_alert: true }).catch(() => { }); return renderTaskManager(ctx); }
  await Task.deleteOne({ taskId: tId });
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Task Deleted", task.title + " (" + task.taskId + ")", 0, null);
  await ctx.answerCallbackQuery({ text: "🗑️ Task Deleted!" }).catch(() => { });
  await renderTaskManager(ctx);
});

bot.callbackQuery(/^toggle_task_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var taskId = ctx.callbackQuery.data.replace("toggle_task_", "");
  var task = await Task.findOne({ taskId });
  if (!task) return ctx.answerCallbackQuery({ text: "Not found", show_alert: true }).catch(() => { });
  task.isActive = task.isActive === false ? true : false;
  await task.save();
  await ctx.answerCallbackQuery({ text: task.isActive ? "Activated" : "Deactivated" }).catch(() => { });
  await renderTaskManager(ctx);
});

bot.callbackQuery(/^task_edit_title_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var tId = ctx.callbackQuery.data.replace("task_edit_title_", "");
  userState[ctx.from.id] = "TASK_EDIT_TITLE_" + tId;
  await ctx.editMessageText("📝 Send new title:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "view_task_" + tId, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^task_edit_reward_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var tId = ctx.callbackQuery.data.replace("task_edit_reward_", "");
  userState[ctx.from.id] = "TASK_EDIT_REWARD_" + tId;
  await ctx.editMessageText("📝 Send new reward:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "view_task_" + tId, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^task_edit_link_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var tId = ctx.callbackQuery.data.replace("task_edit_link_", "");
  userState[ctx.from.id] = "TASK_EDIT_LINK_" + tId;
  await ctx.editMessageText("📝 Send new link:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "view_task_" + tId, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^task_edit_channel_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var tId = ctx.callbackQuery.data.replace("task_edit_channel_", "");
  userState[ctx.from.id] = "TASK_EDIT_CHANNEL_" + tId;
  await ctx.editMessageText("📝 Send new alert channel:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "view_task_" + tId, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^task_edit_type_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var tId = ctx.callbackQuery.data.replace("task_edit_type_", "");
  var task = await Task.findOne({ taskId: tId });
  if (!task) return;
  var newType = (task.taskType || "photo") === "photo" ? "refer" : "photo";
  await Task.updateOne({ taskId: tId }, { taskType: newType });
  await ctx.answerCallbackQuery({ text: newType.toUpperCase() }).catch(() => { });
});

bot.callbackQuery("adm_create_task", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var newTaskId = "T" + Date.now().toString().slice(-10);
  global.taskCreation = global.taskCreation || {};
  global.taskCreation[ctx.from.id] = { taskId: newTaskId, title: null, reward: null, link: null, description: null, expiryMinutes: null };
  await ctx.editMessageText("<b>Task ID Auto-Generated</b>\n\n<code>" + newTaskId + "</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Create Task", callback_data: "task_create_start", style: "success" }], [{ text: "Back", callback_data: "adm_tasks_manager", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("task_create_start", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderCreateTaskPanel(ctx);
});

async function renderCreateTaskPanel(ctx) {
  var temp = global.taskCreation && global.taskCreation[ctx.from.id];
  if (!temp) return ctx.answerCallbackQuery({ text: "Session expired", show_alert: true }).catch(() => { });
  var bodyText = "Task ID: <code>" + temp.taskId + "</code>\n\nTask Name: " + (temp.title || "Not Set") + "    " + (temp.title ? "✅" : "—") + "\nReward: " + (temp.reward ? RUPEE + temp.reward : "Not Set") + "    " + (temp.reward ? "✅" : "—") + "\nLink: " + (temp.link || "Not Set") + "    " + (temp.link ? "✅" : "—") + "\nDescription: " + (temp.description || "Not Set") + "    " + (temp.description ? "✅" : "—") + "\nTime Limit: " + (temp.expiryMinutes ? formatMinutes(temp.expiryMinutes) : "Not Set") + "    " + (temp.expiryMinutes ? "✅" : "—");
  var text = "<b>Create New Task</b>\n\n<blockquote>" + bodyText + "</blockquote>";
  var kb = new InlineKeyboard()
    .row({ text: "Task Name", callback_data: "task_field_name", style: "primary" })
    .row({ text: "Reward", callback_data: "task_field_reward", style: "primary" })
    .row({ text: "Link", callback_data: "task_field_link", style: "primary" })
    .row({ text: "Description", callback_data: "task_field_desc", style: "primary" })
    .row({ text: "Time Limit", callback_data: "task_field_timelimit", style: "primary" })
    .row({ text: "Generate", callback_data: "task_field_submit", style: "success" })
    .row({ text: "Back", callback_data: "adm_tasks_manager", style: "primary" });
  if (ctx.callbackQuery) await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
  else await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("task_field_name", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "TASK_FIELD_NAME";
  await ctx.editMessageText(toSmallCaps("Enter Task Name") + "\n\nSend the task name:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_create_start", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("task_field_reward", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "TASK_FIELD_REWARD";
  await ctx.editMessageText(toSmallCaps("Enter Reward") + "\n\nSend amount in INR:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_create_start", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("task_field_link", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "TASK_FIELD_LINK";
  await ctx.editMessageText(toSmallCaps("Enter Task Link") + "\n\nSend the link:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_create_start", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("task_field_desc", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "TASK_FIELD_DESC";
  await ctx.editMessageText(toSmallCaps("Enter Description") + "\n\nSend description (optional):", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_create_start", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("task_field_timelimit", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var kb = new InlineKeyboard()
    .row({ text: "5 Minutes", callback_data: "task_tl_5", style: "primary" })
    .row({ text: "10 Minutes", callback_data: "task_tl_10", style: "primary" })
    .row({ text: "30 Minutes", callback_data: "task_tl_30", style: "primary" })
    .row({ text: "1 Hour", callback_data: "task_tl_60", style: "primary" })
    .row({ text: "1 Day", callback_data: "task_tl_1440", style: "primary" })
    .row({ text: "Custom Time", callback_data: "task_tl_custom", style: "primary" })
    .row({ text: "Back", callback_data: "task_create_start", style: "primary" });
  await ctx.editMessageText("<b>Time Limit</b>\n\nSelect task expiry time:", { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^task_tl_(\d+)$/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var minutes = parseInt(ctx.callbackQuery.data.replace("task_tl_", ""), 10);
  var temp = global.taskCreation && global.taskCreation[ctx.from.id];
  if (!temp) return ctx.answerCallbackQuery({ text: "Session expired", show_alert: true }).catch(() => { });
  temp.expiryMinutes = minutes;
  await ctx.editMessageText(toSmallCaps("Successfully Added") + "\n\nTime Limit: " + formatMinutes(minutes), { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_create_start", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("task_tl_custom", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "TASK_FIELD_CUSTOM_TIME";
  await ctx.editMessageText("Custom Time Limit\n\nSend time in minutes:\n\nExamples:\n• 5    (5 minutes)\n• 60   (1 hour)\n• 1440 (1 day)", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_field_timelimit", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("task_field_submit", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var temp = global.taskCreation && global.taskCreation[ctx.from.id];
  if (!temp) return ctx.answerCallbackQuery({ text: "Session expired", show_alert: true }).catch(() => { });
  var missing = [];
  if (!temp.title) missing.push("Task Name");
  if (!temp.reward) missing.push("Reward");
  if (!temp.link) missing.push("Link");
  if (missing.length > 0) return ctx.answerCallbackQuery({ text: "Missing: " + missing.join(", "), show_alert: true }).catch(() => { });
  var alertChannel = await getConfig("default_task_alert_channel", "Not Set");
  var expiresAt = null;
  if (temp.expiryMinutes && temp.expiryMinutes > 0) expiresAt = new Date(Date.now() + temp.expiryMinutes * 60 * 1000);
  try {
    await Task.create({ taskId: temp.taskId, title: temp.title, reward: temp.reward, link: temp.link, description: temp.description || "", taskType: "photo", alertChannel: alertChannel, isActive: true, isComplete: true, completedUsers: [], expiryMinutes: temp.expiryMinutes || 0, expiresAt: expiresAt });
    await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Task Created", temp.title, temp.reward);
    delete global.taskCreation[ctx.from.id];
    var bodyText = "Task ID: <code>" + temp.taskId + "</code>\nName: " + temp.title + "\nReward: " + RUPEE + temp.reward + "\nLink: " + temp.link + "\n";
    if (temp.description) bodyText += "Description: " + temp.description + "\n";
    if (temp.expiryMinutes) bodyText += "Time Limit: " + formatMinutes(temp.expiryMinutes) + "\n";
    else bodyText += "Time Limit: None\n";
    bodyText += "Alert Channel: " + alertChannel;
    await ctx.editMessageText("<b>Task Created Successfully</b>\n\n<blockquote>" + bodyText + "</blockquote>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back to Manage Tasks", callback_data: "adm_tasks_manager", style: "primary" }]] } }).catch(() => { });
  } catch (e) { await ctx.reply("Error: " + e.message).catch(() => { }); }
});

bot.callbackQuery("adm_search_task", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "TASK_SEARCH";
  await ctx.editMessageText("<b>Search Task</b>\n\nSend Task ID or Task Name:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_tasks_manager", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_status", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var pendingCount = await Withdrawal.countDocuments({ status: "Pending" });
  var text = "<b>Status</b>\n\n👇 Choose option:";
  var kb = new InlineKeyboard()
    .row({ text: "Live Balance Tracker", callback_data: "status_live_tracker", style: "primary" })
    .row({ text: "Users List", callback_data: "status_users_list", style: "primary" })
    .row({ text: "Live Fund", callback_data: "status_live_fund", style: "primary" })
    .row({ text: "New Users", callback_data: "adm_new_users", style: "primary" })
    .row({ text: "Withdraw Requests (" + pendingCount + ")", callback_data: "status_wd_requests", style: "primary" })
    .row({ text: "Withdraw Stats", callback_data: "status_wd_stats", style: "primary" })
    .row({ text: "Back to Admin", callback_data: "admin", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("status_live_tracker", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderLiveBalanceTracker(ctx, 0);
});

async function renderLiveBalanceTracker(ctx, page) {
  if (page === undefined) page = 0;
  var perPage = 10;
  var totalUsers = await User.countDocuments({});
  var totalPages = Math.ceil(totalUsers / perPage);
  if (page < 0) page = 0;
  if (page >= totalPages) page = Math.max(0, totalPages - 1);
  var users = await User.find({}).sort({ balance: -1, createdAt: -1 }).skip(page * perPage).limit(perPage).lean();
  var totalBalanceArr = await User.aggregate([{ $group: { _id: null, total: { $sum: "$balance" } } }]);
  var totalBalance = totalBalanceArr[0] ? totalBalanceArr[0].total : 0;
  var text = "<b>Live Balance Tracker</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nTotal Users: " + totalUsers + "\nTotal Balance: " + RUPEE + totalBalance.toFixed(2) + "\nPage: " + (page + 1) + "/" + (totalPages || 1) + "\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<b>By Balance High to Low:</b>\n\n";
  users.forEach((u, i) => { text += (page * perPage + i + 1) + ". " + (u.firstName || "User") + "\n   ID: <code>" + u.userId + "</code>\n   Balance: " + formatBalance(u.balance) + "\n\n"; });
  text += "👇 Tap to open profile:";
  var kb = new InlineKeyboard();
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    var name = (u.firstName || "User").substring(0, 15);
    var amount = formatBalance(u.balance);
    kb.row({ text: name + " · " + amount, url: "tg://user?id=" + u.userId, style: "primary" });
  }
  var navRow = [];
  if (page > 0) navRow.push({ text: "◀️", callback_data: "status_lb_page_" + (page - 1), style: "primary" });
  navRow.push({ text: "🔄", callback_data: "status_lb_page_" + page, style: "primary" });
  if (page < totalPages - 1) navRow.push({ text: "▶️", callback_data: "status_lb_page_" + (page + 1), style: "primary" });
  kb.row(...navRow);
  kb.row({ text: "Back", callback_data: "adm_status", style: "primary" });
  if (ctx.callbackQuery) await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
  else await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery(/^status_lb_page_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var page = parseInt(ctx.callbackQuery.data.replace("status_lb_page_", ""), 10);
  await renderLiveBalanceTracker(ctx, page);
});

bot.callbackQuery("status_users_list", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderUsersList(ctx, 0);
});

async function renderUsersList(ctx, page) {
  if (page === undefined) page = 0;
  var perPage = 10;
  var totalUsers = await User.countDocuments({});
  var totalPages = Math.ceil(totalUsers / perPage);
  if (page < 0) page = 0;
  if (page >= totalPages) page = Math.max(0, totalPages - 1);
  var users = await User.find({}).sort({ createdAt: -1 }).skip(page * perPage).limit(perPage).lean();
  var activeCount = await User.countDocuments({ isBanned: false });
  var bannedCount = await User.countDocuments({ isBanned: true });
  var bodyText = "Total: " + totalUsers + "\n✅ Active: " + activeCount + "\n🚫 Banned: " + bannedCount + "\n📄 Page: " + (page + 1) + "/" + (totalPages || 1);
  var text = "<b>Users List</b>\n\n<blockquote>" + bodyText + "</blockquote>";
  var kb = new InlineKeyboard();
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    var name = (u.firstName || "User").substring(0, 12);
    var status = u.isBanned ? "🚫" : "✅";
    kb.row({ text: status + " " + name, callback_data: "userslist_view_" + u.userId, style: "primary" });
  }
  var navRow = [];
  if (page > 0) navRow.push({ text: "◀️", callback_data: "status_ul_page_" + (page - 1), style: "primary" });
  navRow.push({ text: "🔄", callback_data: "status_ul_page_" + page, style: "primary" });
  if (page < totalPages - 1) navRow.push({ text: "▶️", callback_data: "status_ul_page_" + (page + 1), style: "primary" });
  kb.row(...navRow);
  kb.row({ text: "Back", callback_data: "adm_status", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery(/^status_ul_page_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var page = parseInt(ctx.callbackQuery.data.replace("status_ul_page_", ""), 10);
  await renderUsersList(ctx, page);
});

bot.callbackQuery(/^userslist_view_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var uid = parseInt(ctx.callbackQuery.data.replace("userslist_view_", ""), 10);
  var user = await User.findOne({ userId: uid }).lean();
  if (!user) return;
  var bodyText = "Name: " + (user.firstName || "User") + "\nID: " + uid + "\nBalance: " + formatBalance(user.balance) + "\nWithdrawn: " + RUPEE + (user.withdrawnTotal || 0).toFixed(2) + "\nStatus: " + (user.isBanned ? "🚫 Banned" : "✅ Active") + "\nJoined: " + formatDateTime(user.createdAt);
  var text = "<b>User Details</b>\n\n<blockquote>" + bodyText + "</blockquote>";
  var kb = new InlineKeyboard().row({ text: "Back", callback_data: "status_users_list", style: "primary" }, { text: "Admin Panel", callback_data: "admin", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("status_live_fund", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var fund = await LiveFund.findOne({ key: "main_fund" }).lean();
  if (!fund) fund = await LiveFund.create({ key: "main_fund" });
  var totalUsers = await User.countDocuments({});
  var totalBalanceArr = await User.aggregate([{ $group: { _id: null, total: { $sum: "$balance" } } }]);
  var totalBalance = totalBalanceArr[0] ? totalBalanceArr[0].total : 0;
  var totalWdArr = await Withdrawal.aggregate([{ $match: { status: "Approved" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]);
  var totalWd = totalWdArr[0] ? totalWdArr[0].total : 0;
  var running = (fund.totalFund || 0) - (fund.usedFund || 0);
  var usedPercent = fund.totalFund > 0 ? ((fund.usedFund / fund.totalFund) * 100).toFixed(1) : 0;
  var bodyText = "🏦 Bot Total Fund: " + RUPEE + totalBalance.toFixed(2) + "\n📤 Total Paid Out: " + RUPEE + totalWd.toFixed(2) + "\n👥 Total Users: " + totalUsers + "\n\n⚙️ Running Fund System\n📊 Status: " + (fund.isActive ? "🟢 ON" : "🔴 OFF") + "\n💰 Set Fund: " + RUPEE + (fund.totalFund || 0).toFixed(2) + "\n📉 Running: " + RUPEE + running.toFixed(2) + "\n📤 Used: " + RUPEE + (fund.usedFund || 0).toFixed(2) + " (" + usedPercent + "%)";
  var kb = new InlineKeyboard()
    .row({ text: "Set Fund", callback_data: "livefund_set", style: "primary" })
    .row({ text: fund.isActive ? "Turn OFF" : "Turn ON", callback_data: "livefund_toggle", style: fund.isActive ? "danger" : "success" })
    .row({ text: "Reset Fund", callback_data: "livefund_reset", style: "danger" })
    .row({ text: "View Payouts", callback_data: "livefund_payouts", style: "primary" })
    .row({ text: "Back", callback_data: "adm_status", style: "primary" });
  await ctx.editMessageText("<b>Live Fund</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("livefund_set", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "LIVEFUND_WAIT_AMOUNT";
  await ctx.editMessageText("<b>Set Live Fund</b>\n\n📝 Send amount:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "status_live_fund", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("livefund_toggle", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var fund = await LiveFund.findOne({ key: "main_fund" });
  if (!fund) fund = await LiveFund.create({ key: "main_fund" });
  fund.isActive = !fund.isActive;
  fund.updatedAt = new Date();
  await fund.save();
  await ctx.answerCallbackQuery({ text: fund.isActive ? "ON" : "OFF" }).catch(() => { });
});

bot.callbackQuery("livefund_reset", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  await LiveFund.findOneAndUpdate({ key: "main_fund" }, { totalFund: 0, usedFund: 0, updatedAt: new Date() }, { upsert: true });
  await ctx.answerCallbackQuery({ text: "Reset!" }).catch(() => { });
});

bot.callbackQuery("livefund_payouts", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var recent = await Withdrawal.find({ status: "Approved" }).sort({ approvedAt: -1 }).limit(10).lean();
  var bodyText = "";
  if (recent.length === 0) bodyText = "No payouts yet.";
  else {
    for (var i = 0; i < recent.length; i++) {
      var w = recent[i];
      var u = await User.findOne({ userId: w.userId }).lean();
      bodyText += (u ? (u.firstName || "User") : "User") + " — " + RUPEE + w.amount.toFixed(2) + "\n<code>" + w.userId + "</code> | " + formatDateTime(w.approvedAt || w.createdAt) + "\n\n";
    }
  }
  await ctx.editMessageText("<b>Recent Payouts</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "status_live_fund", style: "primary" }]] }, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_new_users", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderNewUsers(ctx, 0);
});

async function renderNewUsers(ctx, page) {
  if (page === undefined) page = 0;
  var perPage = 10;
  var totalUsers = await User.countDocuments({});
  var totalPages = Math.ceil(totalUsers / perPage);
  if (page < 0) page = 0;
  if (page >= totalPages) page = Math.max(0, totalPages - 1);
  var users = await User.find({}).sort({ createdAt: -1 }).skip(page * perPage).limit(perPage).lean();
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  var todayCount = await User.countDocuments({ createdAt: { $gte: today } });
  var weekCount = await User.countDocuments({ createdAt: { $gte: weekAgo } });
  var bodyText = "📊 Total Users: " + totalUsers + "\n📅 Today: " + todayCount + "\n📅 This Week: " + weekCount + "\n📄 Page: " + (page + 1) + "/" + (totalPages || 1);
  var text = "<b>New Users</b>\n\n<blockquote>" + bodyText + "</blockquote>";
  var kb = new InlineKeyboard();
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    var name = (u.firstName || "User").substring(0, 15);
    kb.row({ text: name + " — " + u.userId, callback_data: "newuser_detail_" + u.userId, style: "primary" });
  }
  var navRow = [];
  if (page > 0) navRow.push({ text: "◀️", callback_data: "newusers_page_" + (page - 1), style: "primary" });
  navRow.push({ text: "🔄", callback_data: "newusers_page_" + page, style: "primary" });
  if (page < totalPages - 1) navRow.push({ text: "▶️", callback_data: "newusers_page_" + (page + 1), style: "primary" });
  kb.row(...navRow);
  kb.row({ text: "Back", callback_data: "adm_status", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery(/^newusers_page_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var page = parseInt(ctx.callbackQuery.data.replace("newusers_page_", ""), 10);
  await renderNewUsers(ctx, page);
});

bot.callbackQuery(/^newuser_detail_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var uid = parseInt(ctx.callbackQuery.data.replace("newuser_detail_", ""), 10);
  var u = await User.findOne({ userId: uid }).lean();
  if (!u) return ctx.answerCallbackQuery({ text: "User not found", show_alert: true }).catch(() => { });
  var bodyText = "Name: " + (u.firstName || "Unknown") + "\nUser ID: " + u.userId + "\nUsername: " + (u.username ? "@" + u.username : "No username") + "\n\n🕐 Started Bot:\n" + formatDateTime(u.createdAt);
  var kb = new InlineKeyboard().row({ text: "Back", callback_data: "adm_new_users", style: "primary" }, { text: "Admin Panel", callback_data: "admin", style: "primary" });
  await ctx.editMessageText("<b>User Details</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("status_wd_requests", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var withdrawals = await Withdrawal.find({ status: "Pending" }).sort({ createdAt: -1 }).limit(30).lean();
  if (withdrawals.length === 0) return ctx.editMessageText("<b>Withdraw Requests</b>\n\n<blockquote>No pending requests</blockquote>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_status", style: "primary" }]] } }).catch(() => { });
  var bodyText = "Pending: " + withdrawals.length + "\n\nClick to approve:";
  var text = "<b>Withdraw Requests</b>\n\n<blockquote>" + bodyText + "</blockquote>";
  var kb = new InlineKeyboard();
  for (var i = 0; i < withdrawals.length; i++) {
    var w = withdrawals[i];
    var u = await User.findOne({ userId: w.userId }).lean();
    var name = u ? (u.firstName || "User") : "User";
    var label = name + " — " + RUPEE + w.amount + " (" + w.method + ")";
    if (label.length > 30) label = label.substring(0, 30) + "..";
    kb.row({ text: label, callback_data: "status_wd_view_" + w.withdrawalId, style: "primary" });
  }
  kb.row({ text: "Back", callback_data: "adm_status", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^status_wd_view_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var wdId = ctx.callbackQuery.data.replace("status_wd_view_", "");
  var wd = await Withdrawal.findOne({ withdrawalId: wdId }).lean();
  if (!wd) return ctx.answerCallbackQuery({ text: "Not found", show_alert: true }).catch(() => { });
  var userLink = '<a href="tg://user?id=' + wd.userId + '"><b>' + wd.userId + '</b></a>';
  var maskedDetails = halfMaskDetails(wd.method, wd.details);
  var methodDisplay = wd.method.toUpperCase();
  var methodIcon = wd.method.toLowerCase() === "upi" ? "⚡" : wd.method.toLowerCase() === "bank" ? "🏦" : "🎁";
  var taxAmount = wd.taxAmount || 0;
  var netAmount = wd.netAmount || (wd.amount - taxAmount);
  var text = "⚠️ <b>New " + methodDisplay + " Payout Request!</b> <code>(#" + wd.userWithdrawalCount + ")</code>\n\nUser : " + userLink + "\nRequest Amount : " + RUPEE + "<code>" + wd.amount + "</code>\nAmount After Tax : " + RUPEE + "<code>" + netAmount.toFixed(2) + "</code>\n" + methodIcon + " <b>" + methodDisplay + " ID :</b> <code>" + maskedDetails + "</code>\n\n📊 <b>Status:</b> ⏳ Pending";
  var kb = new InlineKeyboard()
    .row({ text: "Approve ✅", callback_data: "wd_app_" + wd.withdrawalId, style: "success" })
    .row({ text: "Reject ❌", callback_data: "wd_rej_" + wd.withdrawalId, style: "danger" })
    .row({ text: "💰 Fund Verify", callback_data: "fund_verify_" + wd.userId, style: "primary" })
    .row({ text: "🔍 Track Status", callback_data: "track_status_" + wd.withdrawalId, style: "primary" })
    .row({ text: "Back", callback_data: "status_wd_requests", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("status_wd_stats", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var total = await Withdrawal.countDocuments({});
  var approved = await Withdrawal.countDocuments({ status: "Approved" });
  var pending = await Withdrawal.countDocuments({ status: "Pending" });
  var rejected = await Withdrawal.countDocuments({ status: "Rejected" });
  var totalPayoutArr = await Withdrawal.aggregate([{ $match: { status: "Approved" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]);
  var totalPayout = totalPayoutArr[0] ? totalPayoutArr[0].total : 0;
  var bodyText = "Total Requests: " + total + "\nApproved: " + approved + "\nPending: " + pending + "\nRejected: " + rejected + "\n\nTotal Payout: " + RUPEE + totalPayout.toFixed(2) + "\n\nBy Method:\n";
  var methodNames = ["UPI", "BANK", "AMAZON", "REDEEM"];
  for (var i = 0; i < methodNames.length; i++) {
    var count = await Withdrawal.countDocuments({ method: methodNames[i], status: "Approved" });
    if (count > 0) {
      var amtArr = await Withdrawal.aggregate([{ $match: { method: methodNames[i], status: "Approved" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]);
      bodyText += methodNames[i] + ": " + count + " — " + RUPEE + (amtArr[0] ? amtArr[0].total : 0).toFixed(2) + "\n";
    }
  }
  await ctx.editMessageText("<b>Withdraw Stats</b>\n\n<blockquote>" + bodyText + "</blockquote>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_status", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_recent_actions", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var logs = await AdminLog.find({}).sort({ createdAt: -1 }).limit(15).lean();
  var bodyText = "";
  if (logs.length === 0) bodyText = "No actions yet.";
  else {
    for (var i = 0; i < logs.length; i++) {
      var log = logs[i];
      bodyText += (i + 1) + ". " + log.adminName + "\n   " + log.action + (log.details ? ": " + log.details : "") + "\n   " + formatDateTime(log.createdAt) + "\n\n";
    }
  }
  var kb = new InlineKeyboard().row({ text: "Refresh", callback_data: "adm_recent_actions", style: "primary" }).row({ text: "Back", callback_data: "admin", style: "primary" });
  await ctx.editMessageText("<b>Recent Admin Actions</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_manage_channels", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderManageChannels(ctx);
});

async function renderManageChannels(ctx) {
  var channels = await Channel.find({ isActive: true }).sort({ order: 1, addedAt: 1 }).lean();
  var socialLinks = await SocialLink.find({}).lean();
  var bannedAllowed = await getConfig("banned_in_channel_allowed", true);
  var nonAdminBypass = await getConfig("non_admin_channels_bypass", true);
  var showMode = await getConfig("show_mode", "all");
  var text = "📢 <b>Here You Can Manage Your Channels And Social Links</b>\n\nClick On A Channel Or Social Link To Set An Invite Link For Private Channels And Edit Social Link.";
  var kb = new InlineKeyboard();
  for (var i = 0; i < channels.length; i++) {
    var ch = channels[i];
    var shortName = (ch.displayName || ch.channelId).substring(0, 8);
    var visibility = ch.isHidden ? "🙈" : "👀";
    kb.row(
      { text: shortName, callback_data: "ch_edit_" + ch.channelId, style: "primary" },
      { text: "❌", callback_data: "ch_del_" + ch.channelId, style: "danger" },
      { text: "▲", callback_data: "ch_up_" + ch.channelId, style: "primary" },
      { text: "▼", callback_data: "ch_down_" + ch.channelId, style: "primary" },
      { text: visibility, callback_data: "ch_toggle_" + ch.channelId, style: "primary" }
    );
  }
  for (var j = 0; j < socialLinks.length; j++) {
    var s = socialLinks[j];
    var sName = s.name.substring(0, 10);
    kb.row({ text: sName, callback_data: "sl_edit_" + s._id, style: "primary" }, { text: "❌", callback_data: "sl_del_" + s._id, style: "danger" });
  }
  kb.row({ text: "➕ Add Channels", callback_data: "adm_add_channel", style: "success" })
    .row({ text: "➕ Add Payout Channel", callback_data: "adm_add_payout_channel", style: "success" })
    .row({ text: "➕ Add Social Media Links", callback_data: "adm_add_social_link", style: "success" })
    .row({ text: "📢 Broadcast To Channels", callback_data: "adm_broadcast_channels", style: "primary" })
    .row({ text: "⚡ New User Join Channels", callback_data: "adm_new_user_join", style: "primary" })
    .row({ text: "🛡 Banned In Channel ~ " + (bannedAllowed ? "✅ Allowed" : "❌ Not Allowed"), callback_data: "adm_banned_in_channel", style: "primary" })
    .row({ text: "⚙ Non-Admin Channels ~ " + (nonAdminBypass ? "🟢 Bypass" : "🔴 Not Bypass"), callback_data: "adm_non_admin_channels", style: "primary" })
    .row({ text: "⚪ Show Mode: " + (showMode === "all" ? "All Channels" : "Not Joined Only"), callback_data: "adm_show_mode", style: "primary" })
    .row({ text: "Back", callback_data: "admin", style: "primary" });
  if (ctx.callbackQuery) await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
  else await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("adm_add_channel", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "ADD_CHANNEL_WAIT";
  await ctx.editMessageText("<b>Add Channel</b>\n\nSend Your Channel User Name:\n\nExample:\n@mychannel\n-1001234567890", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_manage_channels", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^ch_del_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var chId = ctx.callbackQuery.data.replace("ch_del_", "");
  await Channel.deleteOne({ channelId: chId });
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Channel Deleted", chId, 0, null);
  await ctx.answerCallbackQuery({ text: "Removed!" }).catch(() => { });
  await renderManageChannels(ctx);
});

bot.callbackQuery(/^ch_up_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var chId = ctx.callbackQuery.data.replace("ch_up_", "");
  var channels = await Channel.find({ isActive: true }).sort({ order: 1, addedAt: 1 }).lean();
  var idx = channels.findIndex(function(c) { return c.channelId === chId; });
  if (idx > 0) {
    var currOrder = channels[idx].order || idx;
    var prevOrder = channels[idx - 1].order || (idx - 1);
    await Channel.updateOne({ channelId: chId }, { order: prevOrder });
    await Channel.updateOne({ channelId: channels[idx - 1].channelId }, { order: currOrder });
  }
  await ctx.answerCallbackQuery({ text: "⬆️" }).catch(() => { });
  await renderManageChannels(ctx);
});

bot.callbackQuery(/^ch_down_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var chId = ctx.callbackQuery.data.replace("ch_down_", "");
  var channels = await Channel.find({ isActive: true }).sort({ order: 1, addedAt: 1 }).lean();
  var idx = channels.findIndex(function(c) { return c.channelId === chId; });
  if (idx < channels.length - 1) {
    var currOrder = channels[idx].order || idx;
    var nextOrder = channels[idx + 1].order || (idx + 1);
    await Channel.updateOne({ channelId: chId }, { order: nextOrder });
    await Channel.updateOne({ channelId: channels[idx + 1].channelId }, { order: currOrder });
  }
  await ctx.answerCallbackQuery({ text: "⬇️" }).catch(() => { });
  await renderManageChannels(ctx);
});

bot.callbackQuery(/^ch_toggle_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var chId = ctx.callbackQuery.data.replace("ch_toggle_", "");
  var ch = await Channel.findOne({ channelId: chId });
  if (!ch) return;
  ch.isHidden = !ch.isHidden;
  await ch.save();
  await ctx.answerCallbackQuery({ text: ch.isHidden ? "🙈 Hidden" : "👀 Visible" }).catch(() => { });
  await renderManageChannels(ctx);
});

bot.callbackQuery(/^ch_edit_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var chId = ctx.callbackQuery.data.replace("ch_edit_", "");
  var ch = await Channel.findOne({ channelId: chId }).lean();
  if (!ch) return;
  userState[ctx.from.id] = "CH_EDIT_LINK_" + chId;
  await ctx.editMessageText("<b>Edit Channel</b>\n\nChannel: " + (ch.displayName || ch.channelId) + "\nCurrent Link: " + ch.inviteLink + "\n\nSend new invite link:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_manage_channels", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_add_payout_channel", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var current = await getConfig("payout_channel", null);
  if (!current || current === "Not Set") {
    var methodNames = ["upi", "bank", "wallet", "amazon", "redeem"];
    for (var i = 0; i < methodNames.length; i++) {
      var oldCh = await getConfig("payout_channel_" + methodNames[i], null);
      if (oldCh && oldCh !== "Not Set") { current = oldCh; break; }
    }
  }
  if (!current) current = "Not Set";
  userState[ctx.from.id] = "SET_PAYOUT_CHANNEL";
  await ctx.editMessageText("<b>Set Payout Channel</b>\n\nCurrent: <code>" + current + "</code>\n\nSend Your Payout Channel Link\n\nExample:\n@upi_payouts\n-1001234567890", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel ❌", callback_data: "adm_manage_channels", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_add_social_link", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "ADD_SOCIAL_LINK";
  await ctx.editMessageText("<b>Add Social Media Link</b>\n\nFormat: <code>Name | Link</code>\n\nExample:\n<code>Instagram | https://instagram.com/username</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_manage_channels", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^sl_del_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var id = ctx.callbackQuery.data.replace("sl_del_", "");
  await SocialLink.deleteOne({ _id: id });
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Social Link Deleted", id, 0, null);
  await ctx.answerCallbackQuery({ text: "Removed!" }).catch(() => { });
  await renderManageChannels(ctx);
});

bot.callbackQuery(/^sl_edit_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var id = ctx.callbackQuery.data.replace("sl_edit_", "");
  var s = await SocialLink.findById(id).lean();
  if (!s) return;
  userState[ctx.from.id] = "SL_EDIT_" + id;
  await ctx.editMessageText("<b>Edit Social Link</b>\n\nCurrent: " + s.name + " | " + s.link + "\n\nSend new: <code>Name | Link</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_manage_channels", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_broadcast_channels", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var channels = await Channel.find({ isActive: true }).lean();
  if (channels.length === 0) return ctx.answerCallbackQuery({ text: "No channels added!", show_alert: true }).catch(() => { });
  userState[ctx.from.id] = "BROADCAST_TO_CHANNELS";
  await ctx.editMessageText("<b>Broadcast To Channels</b>\n\n<blockquote>Total: " + channels.length + " channels</blockquote>\n\nSend your broadcast message:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_manage_channels", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_new_user_join", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var channels = await Channel.find({ isActive: true }).sort({ order: 1 }).lean();
  var totalUsers = await User.countDocuments({});
  var forceJoinEnabled = await getConfig("force_join_enabled", true);
  var bodyText = "Bot Total Users: " + totalUsers + "\nForce Join: " + (forceJoinEnabled ? "ON" : "OFF") + "\n\n";
  var kb = new InlineKeyboard();
  for (var i = 0; i < channels.length; i++) {
    var ch = channels[i];
    var joinedCount = await User.countDocuments({ joinedChannels: ch.channelId });
    bodyText += (ch.displayName || ch.channelId) + ": " + joinedCount + "\n";
    kb.row({ text: (ch.displayName || ch.channelId) + " (" + joinedCount + ")", callback_data: "nuj_ch_" + ch.channelId, style: "primary" });
  }
  kb.row({ text: forceJoinEnabled ? "Turn OFF Force Join" : "Turn ON Force Join", callback_data: "adm_toggle_force_join", style: "primary" });
  kb.row({ text: "Back", callback_data: "adm_manage_channels", style: "primary" });
  await ctx.editMessageText("<b>New User Join Channels</b>\n\n<blockquote>" + bodyText + "</blockquote>", { parse_mode: "HTML", reply_markup: kb }).catch(() => { });
});

bot.callbackQuery(/^nuj_ch_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var chId = ctx.callbackQuery.data.replace("nuj_ch_", "");
  var ch = await Channel.findOne({ channelId: chId }).lean();
  if (!ch) return;
  var users = await User.find({ joinedChannels: chId }).limit(50).lean();
  var bodyText = "Channel: " + (ch.displayName || chId) + "\nJoined Users: " + users.length + "\n\n";
  users.forEach(function(u, i) { bodyText += (i + 1) + ". " + (u.firstName || "User") + " — <code>" + u.userId + "</code>\n"; });
  await ctx.editMessageText("<b>Channel Joined Users</b>\n\n<blockquote>" + bodyText + "</blockquote>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_new_user_join", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_toggle_force_join", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var cur = await getConfig("force_join_enabled", true);
  await setConfig("force_join_enabled", !cur);
  await ctx.answerCallbackQuery({ text: !cur ? "ON" : "OFF" }).catch(() => { });
});

bot.callbackQuery("adm_banned_in_channel", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var cur = await getConfig("banned_in_channel_allowed", true);
  await setConfig("banned_in_channel_allowed", !cur);
  await ctx.answerCallbackQuery({ text: !cur ? "Allowed" : "Not Allowed" }).catch(() => { });
  await renderManageChannels(ctx);
});

bot.callbackQuery("adm_non_admin_channels", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var cur = await getConfig("non_admin_channels_bypass", true);
  await setConfig("non_admin_channels_bypass", !cur);
  await ctx.answerCallbackQuery({ text: !cur ? "Bypass" : "Not Bypass" }).catch(() => { });
  await renderManageChannels(ctx);
});

bot.callbackQuery("adm_show_mode", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var cur = await getConfig("show_mode", "all");
  await setConfig("show_mode", cur === "all" ? "not_joined" : "all");
  await ctx.answerCallbackQuery({ text: cur === "all" ? "Not Joined Only" : "All Channels" }).catch(() => { });
  await renderManageChannels(ctx);
});

bot.callbackQuery("adm_customize_theme", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var text = "<b>Customize Your Theme</b>\n\n👇 Choose what to customize:";
  var kb = new InlineKeyboard()
    .row({ text: "Admin Panel Customizing", callback_data: "adm_panel_custom", style: "primary" })
    .row({ text: "Keyboard Buttons Customizing", callback_data: "adm_keyboard_custom", style: "primary" })
    .row({ text: "Inline Button Colors", callback_data: "adm_inline_colors", style: "primary" })
    .row({ text: "Font Editing", callback_data: "adm_font_edit", style: "primary" })
    .row({ text: "Edit Unknown Command", callback_data: "adm_unknown_cmd", style: "primary" })
    .row({ text: "Edit Balance Text", callback_data: "adm_edit_balance_text", style: "primary" })
    .row({ text: "Start Command Edit", callback_data: "adm_start_edit", style: "primary" })
    .row({ text: "Customer Support", callback_data: "adm_support", style: "primary" })
    .row({ text: "Manage Withdraw", callback_data: "adm_manage_withdraw", style: "primary" })
    .row({ text: "Back to Admin", callback_data: "admin", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_font_edit", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderFontEditPage(ctx);
});

async function renderFontEditPage(ctx) {
  var currentFont = await getConfig("bot_font", "normal");
  var text = "<b>Font Editing</b>\n\n📊 Current Font: <b>" + currentFont + "</b>\n\n👇 Select your font style:\n\n<i>Preview: Admin Panel</i>";
  var kb = new InlineKeyboard();
  var previews = {
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
  for (var i = 0; i < FONT_OPTIONS.length; i++) {
    var opt = FONT_OPTIONS[i];
    var check = currentFont === opt.key ? "✅" : "";
    kb.row({ text: opt.name + " " + check + " — " + previews[opt.key], callback_data: "font_set_" + opt.key, style: "primary" });
  }
  kb.row({ text: "Back to Theme", callback_data: "adm_customize_theme", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery(/^font_set_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var fontKey = ctx.callbackQuery.data.replace("font_set_", "");
  await setConfig("bot_font", fontKey);
  configCache.data["bot_font"] = fontKey;
  await ctx.answerCallbackQuery({ text: "Font: " + fontKey }).catch(() => { });
});

bot.callbackQuery("adm_unknown_cmd", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderUnknownCmdPage(ctx);
});

async function renderUnknownCmdPage(ctx) {
  var isActive = await getConfig("unknown_command_active", false);
  var statusText = isActive ? "🟢 ON" : "🔴 OFF";
  var toggleText = isActive ? "Turn OFF" : "Turn ON";
  var text = "<b>Edit Unknown Command</b>\n\nStatus: " + statusText + "\n\n";
  var kb = new InlineKeyboard()
    .row({ text: toggleText, callback_data: "unknown_toggle", style: "primary" })
    .row({ text: "Edit Text", callback_data: "unknown_edit_text", style: "primary" })
    .row({ text: "Back to Theme", callback_data: "adm_customize_theme", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("unknown_toggle", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var cur = await getConfig("unknown_command_active", false);
  await setConfig("unknown_command_active", !cur);
  await ctx.answerCallbackQuery({ text: !cur ? "🟢 ON" : "🔴 OFF" }).catch(() => { });
});

bot.callbackQuery("unknown_edit_text", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "UNKNOWN_CMD_EDIT_TEXT";
  var currentText = await getConfig("unknown_command_text", "I didn't understand that.\n\nPlease /start the bot again.");
  await ctx.editMessageText("<b>Edit Text</b>\n\nCurrent Text:\n" + escapeHtml(currentText) + "\n\n📝 Send new text:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_unknown_cmd", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_edit_balance_text", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var welcomeText = await getConfig("balance_welcome_text", DEFAULT_BALANCE_TEXT.welcome);
  var footerText = await getConfig("balance_footer_text", DEFAULT_BALANCE_TEXT.footer);
  var bodyText = "Current:\n\n" + welcomeText + "\n\n🔵 Wallet ID ➝ 123456789\n🧾 Balance ➝ " + RUPEE + "500.00\n\n❝ " + footerText + " ❞";
  var text = "<b>Edit Balance Text</b>\n\n<blockquote>" + bodyText + "</blockquote>\n\n👇 Choose:";
  var kb = new InlineKeyboard()
    .row({ text: "Edit Welcome Message", callback_data: "adm_edit_welcome", style: "primary" })
    .row({ text: "Edit Footer Text", callback_data: "adm_edit_footer", style: "primary" })
    .row({ text: "Reset to Default", callback_data: "adm_reset_balance_text", style: "danger" })
    .row({ text: "Back", callback_data: "adm_customize_theme", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_edit_welcome", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var cur = await getConfig("balance_welcome_text", DEFAULT_BALANCE_TEXT.welcome);
  userState[ctx.from.id] = "EDIT_WELCOME_TEXT";
  await ctx.editMessageText("<b>Edit Welcome Message</b>\n\nCurrent:\n" + cur + "\n\n✏️ Send new message:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_edit_balance_text", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_edit_footer", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var cur = await getConfig("balance_footer_text", DEFAULT_BALANCE_TEXT.footer);
  userState[ctx.from.id] = "EDIT_FOOTER_TEXT";
  await ctx.editMessageText("<b>Edit Footer Text</b>\n\nCurrent:\n" + cur + "\n\n✏️ Send new footer:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_edit_balance_text", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_reset_balance_text", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await ctx.editMessageText("⚠️ <b>Reset to Default?</b>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Yes, Reset", callback_data: "adm_reset_balance_text_yes", style: "success" }, { text: "Cancel", callback_data: "adm_edit_balance_text", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_reset_balance_text_yes", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  await setConfig("balance_welcome_text", DEFAULT_BALANCE_TEXT.welcome);
  await setConfig("balance_footer_text", DEFAULT_BALANCE_TEXT.footer);
  await ctx.answerCallbackQuery({ text: "Reset!" }).catch(() => { });
  await ctx.editMessageText("<b>Reset Complete!</b>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_edit_balance_text", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_start_edit", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var titleText = await getConfig("start_title_text", DEFAULT_START_TEXT.title);
  var linkPrefix = await getConfig("start_link_prefix", DEFAULT_START_TEXT.linkPrefix);
  var linkClickable = await getConfig("start_link_clickable", DEFAULT_START_TEXT.linkClickable);
  var welcomeLink = await getConfig("welcome_channel_link", "https://t.me/yourchannel");
  var bodyText = "Title:\n" + titleText + "\n\nLink Prefix:\n" + linkPrefix + "\n\nClickable:\n" + linkClickable + "\n\nLink:\n" + welcomeLink;
  var text = "<b>Start Command Edit</b>\n\n<blockquote>" + bodyText + "</blockquote>\n\n👇 Choose what to edit:";
  var kb = new InlineKeyboard()
    .row({ text: "Edit Title Text", callback_data: "adm_start_edit_title", style: "primary" })
    .row({ text: "Edit Link Prefix", callback_data: "adm_start_edit_prefix", style: "primary" })
    .row({ text: "Edit Clickable Text", callback_data: "adm_start_edit_clickable", style: "primary" })
    .row({ text: "Set Link URL", callback_data: "adm_start_edit_url", style: "primary" })
    .row({ text: "Reset to Default", callback_data: "adm_start_reset", style: "danger" })
    .row({ text: "Back", callback_data: "adm_customize_theme", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_start_edit_title", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var cur = await getConfig("start_title_text", DEFAULT_START_TEXT.title);
  userState[ctx.from.id] = "EDIT_START_TITLE";
  await ctx.editMessageText("<b>Edit Title Text</b>\n\nCurrent:\n" + cur + "\n\n✏️ Send new title:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_start_edit", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_start_edit_prefix", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var cur = await getConfig("start_link_prefix", DEFAULT_START_TEXT.linkPrefix);
  userState[ctx.from.id] = "EDIT_START_LINK_PREFIX";
  await ctx.editMessageText("<b>Edit Link Prefix</b>\n\nCurrent:\n" + cur + "\n\n✏️ Send new prefix:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_start_edit", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_start_edit_clickable", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var cur = await getConfig("start_link_clickable", DEFAULT_START_TEXT.linkClickable);
  userState[ctx.from.id] = "EDIT_START_LINK_CLICKABLE";
  await ctx.editMessageText("<b>Edit Clickable Text</b>\n\nCurrent:\n" + cur + "\n\n✏️ Send new clickable text:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_start_edit", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_start_edit_url", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var cur = await getConfig("welcome_channel_link", "https://t.me/yourchannel");
  userState[ctx.from.id] = "EDIT_START_URL";
  await ctx.editMessageText("<b>Set Link URL</b>\n\n📌 Current: <code>" + cur + "</code>\n\n📝 Send new link:\n\nExamples:\n• <code>https://t.me/yourchannel</code>\n• <code>@yourchannel</code>\n• <code>123456789</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_start_edit", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_start_reset", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await ctx.editMessageText("⚠️ <b>Reset Start Text?</b>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Yes, Reset", callback_data: "adm_start_reset_yes", style: "success" }, { text: "Cancel", callback_data: "adm_start_edit", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_start_reset_yes", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  await setConfig("start_title_text", DEFAULT_START_TEXT.title);
  await setConfig("start_link_prefix", DEFAULT_START_TEXT.linkPrefix);
  await setConfig("start_link_clickable", DEFAULT_START_TEXT.linkClickable);
  await ctx.answerCallbackQuery({ text: "Reset!" }).catch(() => { });
  await ctx.editMessageText("<b>Reset Complete!</b>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_start_edit", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_support", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var current = await getConfig("support_username", "Not Set");
  var displayCurrent = current !== "Not Set" ? "<code>" + current + "</code>" : "<code>Not Set</code>";
  var linkCurrent = current !== "Not Set" ? convertOwnerLink(current) : "Not Set";
  var text = "<b>Customer Support</b>\n\n📌 Current: " + displayCurrent + "\n🔗 Link: " + linkCurrent + "\n\n👇 Choose action:";
  var kb = new InlineKeyboard()
    .row({ text: "Set Support", callback_data: "adm_support_set", style: "primary" })
    .row({ text: "Clear", callback_data: "adm_support_clear", style: "danger" })
    .row({ text: "Back", callback_data: "adm_customize_theme", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_support_set", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "SUPPORT_SET";
  await ctx.editMessageText("<b>Set Customer Support</b>\n\n📝 Send your Telegram ID or Link:\n\nExamples:\n• <code>123456789</code>\n• <code>@azeeznasi</code>\n• <code>https://t.me/azeeznasi</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_support", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_support_clear", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await setConfig("support_username", "Not Set");
  await ctx.editMessageText("<b>Customer Support Cleared!</b>\n\n📌 Current: <code>Not Set</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_support", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_create_gift", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderGiftCodePanel(ctx);
});

async function renderGiftCodePanel(ctx) {
  var codes = await GiftCode.find({ type: "redeem" }).sort({ createdAt: -1 }).limit(20).lean();
  var totalCodes = await GiftCode.countDocuments({ type: "redeem" });
  var text = "<b>Gift Codes</b>\n\nTotal: " + totalCodes + "\n\n👇 Click code to edit:";
  var kb = new InlineKeyboard();
  for (var i = 0; i < codes.length; i++) {
    var c = codes[i];
    var shortCode = c.code.length > 15 ? c.code.substring(0, 15) + "..." : c.code;
    var status = c.usedUsers.length >= c.maxUses ? "❌" : "✅";
    kb.row({ text: status + " " + shortCode + " — " + RUPEE + c.amount, callback_data: "gc_view_" + c.code, style: "primary" });
  }
  kb.row({ text: "Add Codes", callback_data: "adm_redeem_add", style: "success" }).row({ text: "Back", callback_data: "admin", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery(/^gc_view_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var code = ctx.callbackQuery.data.replace("gc_view_", "");
  var gc = await GiftCode.findOne({ code: code, type: "redeem" }).lean();
  if (!gc) return;
  var text = "<b>Code:</b> <code>" + gc.code + "</code>\n\n💰 Amount: " + RUPEE + gc.amount + "\n📊 Claimed: " + gc.usedUsers.length + "/" + gc.maxUses;
  var kb = new InlineKeyboard().row({ text: "Delete", callback_data: "gc_del_" + gc.code, style: "danger" }).row({ text: "Back", callback_data: "adm_create_gift", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^gc_del_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var code = ctx.callbackQuery.data.replace("gc_del_", "");
  await GiftCode.deleteOne({ code: code, type: "redeem" });
  await ctx.answerCallbackQuery({ text: "Deleted!" }).catch(() => { });
  await renderGiftCodePanel(ctx);
});

bot.callbackQuery("adm_redeem", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderGiftCodePanel(ctx);
});

bot.callbackQuery("adm_redeem_add", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "WAITING_REDEEM_CODES";
  await ctx.editMessageText("➕ <b>Add Redeem Codes</b>\n\n📝 Format: <code>CODE AMOUNT</code>\n\nExample:\n<code>WELCOME100 100</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_create_gift", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_amazon", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderAmazonPanel(ctx);
});

async function renderAmazonPanel(ctx) {
  var codes = await GiftCode.find({ type: "amazon" }).sort({ createdAt: -1 }).limit(20).lean();
  var totalCodes = await GiftCode.countDocuments({ type: "amazon" });
  var text = "<b>Amazon Codes</b>\n\nTotal: " + totalCodes + "\n\n👇 Click code to edit:";
  var kb = new InlineKeyboard();
  for (var i = 0; i < codes.length; i++) {
    var c = codes[i];
    var shortCode = c.code.length > 15 ? c.code.substring(0, 15) + "..." : c.code;
    var status = c.usedUsers.length >= c.maxUses ? "❌" : "✅";
    kb.row({ text: status + " " + shortCode + " — " + RUPEE + c.amount, callback_data: "amz_view_" + c.code, style: "primary" });
  }
  kb.row({ text: "Add Codes", callback_data: "adm_amazon_add", style: "success" }).row({ text: "Back", callback_data: "admin", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery(/^amz_view_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var code = ctx.callbackQuery.data.replace("amz_view_", "");
  var gc = await GiftCode.findOne({ code: code, type: "amazon" }).lean();
  if (!gc) return;
  var text = "<b>Code:</b> <code>" + gc.code + "</code>\n\n💰 Amount: " + RUPEE + gc.amount + "\n📊 Claimed: " + gc.usedUsers.length + "/" + gc.maxUses;
  var kb = new InlineKeyboard().row({ text: "Delete", callback_data: "amz_del_" + gc.code, style: "danger" }).row({ text: "Back", callback_data: "adm_amazon", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^amz_del_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var code = ctx.callbackQuery.data.replace("amz_del_", "");
  await GiftCode.deleteOne({ code: code, type: "amazon" });
  await ctx.answerCallbackQuery({ text: "Deleted!" }).catch(() => { });
  await renderAmazonPanel(ctx);
});

bot.callbackQuery("adm_amazon_add", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "WAITING_AMAZON_CODES";
  await ctx.editMessageText("➕ <b>Add Amazon Codes</b>\n\n📝 Format: <code>CODE AMOUNT</code>\n\nExample:\n<code>AMZ100 100</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_amazon", style: "danger" }]] } }).catch(() => { });
});

async function saveCodes(text, type, ctx) {
  var lines = text.trim().split("\n").filter(function(l) { return l.trim() !== ""; });
  var added = [], failed = [];
  for (var i = 0; i < lines.length; i++) {
    var parts = lines[i].trim().split(/\s+/);
    if (parts.length !== 2) { failed.push(lines[i] + " (invalid)"); continue; }
    var code = parts[0].trim();
    var amount = parseFloat(parts[1]);
    if (isNaN(amount) || amount <= 0) { failed.push(lines[i] + " (invalid)"); continue; }
    var existing = await GiftCode.findOne({ code: code, type: type });
    if (existing) { failed.push(code + " (exists)"); continue; }
    await GiftCode.create({ code: code, amount: amount, type: type, maxUses: 1, usedUsers: [] });
    added.push("✅ <code>" + code + "</code> → " + RUPEE + amount);
  }
  var icon = type === "amazon" ? "📧" : "🎁";
  var title = type === "amazon" ? "Amazon Codes" : "Redeem Codes";
  var summary = icon + " <b>" + title + " Added</b>\n\n";
  if (added.length > 0) summary += "✅ Added (" + added.length + "):\n" + added.join("\n") + "\n\n";
  if (failed.length > 0) summary += "❌ Failed (" + failed.length + "):\n" + failed.map(function(f) { return "• " + f; }).join("\n") + "\n\n";
  summary += "📊 Added: " + added.length + " | ❌ Failed: " + failed.length;
  await ctx.reply(summary, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: type === "amazon" ? "adm_amazon" : "adm_create_gift", style: "primary" }]] } }).catch(() => { });
}

bot.callbackQuery("admin", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  delete userState[ctx.from.id];
  await sendAdminPanel(ctx, true);
});

async function sendAdminPanel(ctx, edit) {
  if (edit === undefined) edit = true;
  var counts = await Promise.all([
    User.countDocuments({}),
    BotAdmin.countDocuments({ isActive: true }),
    Gateway.countDocuments({ isActive: true })
  ]);
  var userCount = counts[0], activeAdmins = counts[1], gatewayCount = counts[2];
  var botStatus = await getConfig("bot_status", "active");
  var statusDisplay = botStatus === "active" ? "\u2705 Active" : (botStatus === "maintenance" ? "\u26A0\uFE0F Maintenance" : "\u274C Disabled");
  var minW = await getConfig("min_withdraw", 0);
  var maxW = await getConfig("max_withdraw", 0);
  var pChannel = await getConfig("payout_channel", null);
  if (!pChannel || pChannel === "Not Set") pChannel = "Not Set";
  var supportId = await getConfig("support_username", "Not Set");
  var quickTaxEnabled = await getConfig("quick_pay_enabled", true);
  var quickTaxPercent = await getConfig("quick_pay_tax_percent", 0);
  var panelText = "\uD83D\uDC51 <b>Admin Panel</b>\n\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n" +
    "\uD83E\uDD16 <b>Bot Status:</b> " + statusDisplay + "\n" +
    "\uD83D\uDCB8 <b>Min:</b> " + RUPEE + minW + " | \uD83D\uDCB0 <b>Max:</b> " + RUPEE + maxW + "\n" +
    "\uD83D\uDCE2 <b>Payout:</b> <code>" + pChannel + "</code>\n" +
    "\uD83D\uDCAC <b>Support:</b> <code>" + supportId + "</code>\n" +
    "\uD83C\uDF10 <b>Gateways:</b> " + gatewayCount + " active\n" +
    "\u26A1 <b>Quick Pay:</b> " + (quickTaxEnabled ? "\uD83D\uDFE2 ON" : "\uD83D\uDD34 OFF") + " (Tax: " + quickTaxPercent + "%)\n" +
    "\uD83D\uDC65 <b>Users:</b> " + userCount + " | \uD83D\uDC51 <b>Admins:</b> " + activeAdmins + "\n\n" +
    "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501";
  var freshConfig = await Config.findOne({ key: "admin_panel_layout" }).lean();
  var layout = (freshConfig && freshConfig.value) ? freshConfig.value : DEFAULT_ADMIN_PANEL_LAYOUT;
  configCache.data["admin_panel_layout"] = layout;
  var visibleLayout = layout.filter(function(b) { return !b.hidden; });
  var rawButtons = [];
  var maxRow = visibleLayout.length > 0 ? Math.max.apply(null, visibleLayout.map(function(b) { return b.row; })) : 0;
  for (var r = 0; r <= maxRow; r++) {
    var rowButtons = visibleLayout.filter(function(b) { return b.row === r; });
    if (rowButtons.length > 0) {
      var row = rowButtons.map(function(btn) {
        var b = { text: btn.name, callback_data: btn.key };
        if (btn.style && ["primary", "success", "danger"].indexOf(btn.style) >= 0) b.style = btn.style;
        return b;
      });
      rawButtons.push(row);
    }
  }
  var styledKb = { inline_keyboard: rawButtons };
  if (edit && ctx.callbackQuery) await ctx.editMessageText(panelText, { reply_markup: styledKb, parse_mode: "HTML" }).catch(() => { });
  else await ctx.reply(panelText, { reply_markup: styledKb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("adm_permissions", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderPermissionsPanel(ctx);
});

async function renderPermissionsPanel(ctx) {
  var ownerId = await getConfig("owner_id", MAIN_OWNER_ID);
  var ownerUser = await User.findOne({ userId: ownerId }).lean();
  var admins = await BotAdmin.find({}).sort({ addedAt: -1 }).lean();
  var bodyText = "\uD83D\uDC51 <b>Owner:</b> " + (ownerUser ? (ownerUser.firstName || "Owner") : "Owner") + "\n\uD83C\uDD94 <code>" + ownerId + "</code>\n\n\uD83D\uDCCA Total Admins: " + admins.length + "\n\n\uD83D\uDC47 Click to toggle / remove:";
  var text = "<b>Admin Permissions</b>\n\n<blockquote>" + bodyText + "</blockquote>";
  var kb = new InlineKeyboard();
  for (var i = 0; i < admins.length; i++) {
    var a = admins[i];
    var u = await User.findOne({ userId: a.userId }).lean();
    var name = u ? (u.firstName || "User") : "Unknown";
    var status = a.isActive ? "\uD83D\uDFE2" : "\uD83D\uDD34";
    kb.row({ text: status + " " + name + " — " + a.userId, callback_data: "adm_perm_toggle_" + a.userId, style: "primary" });
    kb.row({ text: "Remove", callback_data: "adm_perm_remove_" + a.userId, style: "danger" });
  }
  kb.row({ text: "Add New Admin", callback_data: "admin_add", style: "success" });
  kb.row({ text: "Back to Admin", callback_data: "admin", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery(/^adm_perm_toggle_/, async (ctx) => {
  if (!(await isOwner(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Owner only!", show_alert: true }).catch(() => { });
  var adminId = parseInt(ctx.callbackQuery.data.replace("adm_perm_toggle_", ""), 10);
  var admin = await BotAdmin.findOne({ userId: adminId });
  if (!admin) return ctx.answerCallbackQuery({ text: "Not found", show_alert: true }).catch(() => { });
  admin.isActive = !admin.isActive;
  if (!admin.isActive) { admin.disabledAt = new Date(); admin.disabledBy = ctx.from.id; }
  else { admin.disabledAt = null; admin.disabledBy = null; }
  await admin.save();
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Owner", admin.isActive ? "Admin Enabled" : "Admin Disabled", String(adminId), 0, adminId);
  await ctx.answerCallbackQuery({ text: admin.isActive ? "🟢 Enabled" : "🔴 Disabled" }).catch(() => { });
  await renderPermissionsPanel(ctx);
});

bot.callbackQuery(/^adm_perm_remove_/, async (ctx) => {
  if (!(await isOwner(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Owner only!", show_alert: true }).catch(() => { });
  var adminId = parseInt(ctx.callbackQuery.data.replace("adm_perm_remove_", ""), 10);
  await BotAdmin.deleteOne({ userId: adminId });
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Owner", "Admin Removed", String(adminId), 0, adminId);
  await ctx.answerCallbackQuery({ text: "Removed!" }).catch(() => { });
  await renderPermissionsPanel(ctx);
});

bot.callbackQuery("admin_add", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isOwner(ctx.from.id))) return;
  userState[ctx.from.id] = "WAITING_ADMIN_ADD";
  await ctx.editMessageText("<b>Add New Admin</b>\n\n📝 Send User ID or @username:\n\nExample:\n<code>123456789</code>\n<code>@username</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_permissions", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_transfer", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isOwner(ctx.from.id))) return;
  userState[ctx.from.id] = "WAITING_NEW_OWNER";
  await ctx.editMessageText("<b>Transfer Ownership</b>\n\n⚠️ You will become an Admin.\n\n📝 Send new Owner User ID:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "admin", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^admin_transfer_confirm_/, async (ctx) => {
  if (!(await isOwner(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var newOwnerId = parseInt(ctx.callbackQuery.data.replace("admin_transfer_confirm_", ""), 10);
  if (isNaN(newOwnerId)) return;
  var targetUser = await User.findOne({ userId: newOwnerId });
  if (!targetUser) return ctx.answerCallbackQuery({ text: "User not found!", show_alert: true }).catch(() => { });
  await BotAdmin.findOneAndUpdate({ userId: ctx.from.id }, { addedAt: new Date(), addedBy: ctx.from.id, isActive: true }, { upsert: true });
  await setConfig("owner_id", newOwnerId);
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Owner", "Ownership Transferred", "New owner: " + newOwnerId, 0, newOwnerId);
  try { await ctx.api.sendMessage(newOwnerId, "👑 <b>Congratulations!</b>\nYou are now the OWNER of this bot!\n\nFull control granted.", { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
  await ctx.answerCallbackQuery({ text: "✅ Transferred!" }).catch(() => { });
  await sendAdminPanel(ctx, true);
});

bot.callbackQuery("adm_admins", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderPermissionsPanel(ctx);
});

bot.callbackQuery("adm_bot_status", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var current = await getConfig("bot_status", "active");
  var next = current === "active" ? "maintenance" : current === "maintenance" ? "disabled" : "active";
  await setConfig("bot_status", next);
  await setConfig("bot_active", next === "active");
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Bot Status Changed", current + " -> " + next, 0, null);
  var toastMsg = next === "active" ? "✅ Active" : next === "maintenance" ? "⚠️ Maintenance" : "❌ Disabled";
  await ctx.answerCallbackQuery({ text: toastMsg }).catch(() => { });
  await sendAdminPanel(ctx, true);
});

bot.callbackQuery("adm_manage_ban", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var bannedUsers = await User.find({ isBanned: true }).limit(20).lean();
  var bodyText = "Total Banned: " + bannedUsers.length + "\n\n";
  bannedUsers.forEach(function(u, i) { bodyText += (i + 1) + ". " + (u.firstName || "User") + " — <code>" + u.userId + "</code>\n"; });
  var kb = new InlineKeyboard()
    .row({ text: "Ban New User", callback_data: "adm_ban_new", style: "danger" })
    .row({ text: "Unban User", callback_data: "adm_unban_user", style: "success" })
    .row({ text: "Back", callback_data: "admin", style: "primary" });
  await ctx.editMessageText("<b>Manage Ban Users</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_ban_new", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "BAN_USER_WAIT";
  await ctx.editMessageText("🚫 Send User ID to BAN:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_manage_ban", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_unban_user", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "UNBAN_USER_WAIT";
  await ctx.editMessageText("🔓 Send User ID to UNBAN:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_manage_ban", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_manage_ban_wallet", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var unlimitedWallet = await getConfig("unlimited_wallet", false);
  var onetimeWallet = await getConfig("onetime_wallet", false);
  var text = "<b>Manage Ban Wallet</b>\n\n♾️ Unlimited: " + (unlimitedWallet ? "🟢 ON" : "🔴 OFF") + "\n⏱️ One-Time: " + (onetimeWallet ? "🟢 ON" : "🔴 OFF");
  var kb = new InlineKeyboard()
    .row({ text: "Ban Wallet", callback_data: "adm_ban_wallet", style: "danger" })
    .row({ text: unlimitedWallet ? "Unlimited: ON" : "Unlimited: OFF", callback_data: "adm_unlimited_wallet", style: "primary" })
    .row({ text: onetimeWallet ? "One-Time: ON" : "One-Time: OFF", callback_data: "adm_onetime_wallet", style: "primary" })
    .row({ text: "Back", callback_data: "admin", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_ban_wallet", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "BAN_WALLET_WAIT";
  await ctx.editMessageText("🚫 Send Wallet ID to BAN:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_manage_ban_wallet", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_unlimited_wallet", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var cur = await getConfig("unlimited_wallet", false);
  await setConfig("unlimited_wallet", !cur);
  await ctx.answerCallbackQuery({ text: !cur ? "ON" : "OFF" }).catch(() => { });
});

bot.callbackQuery("adm_onetime_wallet", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var cur = await getConfig("onetime_wallet", false);
  await setConfig("onetime_wallet", !cur);
  await ctx.answerCallbackQuery({ text: !cur ? "ON" : "OFF" }).catch(() => { });
});

bot.callbackQuery("adm_wd_status", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var isEnabled = await getConfig("withdraw_enabled", true);
  var status = isEnabled ? "ON" : "OFF";
  var desc = isEnabled ? "All users can request withdrawals." : "All withdrawal requests disabled.";
  var text = "<b>Withdraw Status</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nGlobal Withdraw: <b>" + status + "</b>\n\n" + desc + "\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
  var kb = new InlineKeyboard().row({ text: isEnabled ? "Turn OFF" : "Turn ON", callback_data: "toggle_withdraw_global", style: isEnabled ? "danger" : "success" }).row({ text: "Back", callback_data: "admin", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("toggle_withdraw_global", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var current = await getConfig("withdraw_enabled", true);
  await setConfig("withdraw_enabled", !current);
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", !current ? "Withdraw Enabled" : "Withdraw Disabled", "", 0, null);
  await ctx.answerCallbackQuery({ text: !current ? "ON" : "OFF" }).catch(() => { });
});

bot.callbackQuery("adm_add_bal", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "WAITING_FOR_ADD_BAL";
  await ctx.editMessageText("➕ <b>Add Balance</b>\n\n📝 Send:\n<code>UserID Amount</code>\n<code>@username Amount</code>\n\n💡 Example:\n<code>8061612320 100</code>\n<code>@myfriend 50</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admin", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_rem_bal", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "WAITING_FOR_REM_BAL";
  await ctx.editMessageText("➖ <b>Remove Balance</b>\n\n📝 Send:\n<code>UserID Amount</code>\n<code>@username Amount</code>\n\n💡 Example:\n<code>8061612320 100</code>\n<code>@myfriend 50</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admin", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_reset_all_bal", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var userCount = await User.countDocuments({});
  var kb = new InlineKeyboard().row({ text: "Yes, Reset All", callback_data: "adm_reset_all_confirm", style: "danger" }).row({ text: "Cancel", callback_data: "admin", style: "primary" });
  await ctx.editMessageText("⚠️ <b>RESET ALL BALANCES</b>\n\nUsers: " + userCount + "\n\nThis will reset EVERYONE's balance to 0!\n\nConfirm?", { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_reset_all_confirm", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  await ctx.answerCallbackQuery({ text: "Resetting..." }).catch(() => { });
  await User.updateMany({}, { $set: { balance: 0, withdrawnTotal: 0 } });
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Reset All Balances", "All users", 0, null);
  await ctx.editMessageText("All balances reset to 0", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admin", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_talk_user", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "WAITING_FOR_USER_MESSAGE";
  await ctx.editMessageText("💬 Format: <code>UserID | Message</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "admin", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_find_user", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "WAITING_FOR_TRACKER_ID";
  await ctx.editMessageText("<b>Find User Details</b>\n\n📝 Send User ID:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admin", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery(/^user_detail_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var uid = parseInt(ctx.callbackQuery.data.replace("user_detail_", ""), 10);
  var u = await User.findOne({ userId: uid }).lean();
  if (!u) return;
  var approvedCount = await Withdrawal.countDocuments({ userId: uid, status: "Approved" });
  var totalWdArr = await Withdrawal.aggregate([{ $match: { userId: uid, status: "Approved" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]);
  var totalWd = totalWdArr[0] ? totalWdArr[0].total : 0;
  var bodyText = "Name: " + (u.firstName || "User") + "\nID: " + uid + "\nUsername: " + (u.username ? "@" + u.username : "None") + "\n\nBalance: " + formatBalance(u.balance) + "\nTotal Withdrawn: " + RUPEE + totalWd.toFixed(2) + "\nWithdraw Count: " + approvedCount + "\n\nJoined: " + formatDateTime(u.createdAt);
  var text = "<b>User Details</b>\n\n<blockquote>" + bodyText + "</blockquote>";
  var kb = new InlineKeyboard()
    .row({ text: "Linked Withdraw", callback_data: "user_linked_" + uid, style: "primary" })
    .row({ text: "Withdraw History", callback_data: "user_wd_hist_" + uid, style: "primary" })
    .row({ text: "Balance History", callback_data: "user_bal_hist_" + uid, style: "primary" })
    .row({ text: "Add Balance", callback_data: "user_add_bal_" + uid, style: "success" }, { text: "Remove Balance", callback_data: "user_rem_bal_" + uid, style: "danger" })
    .row({ text: "Send Message", callback_data: "user_send_msg_" + uid, style: "primary" }, { text: "Ban/Unban", callback_data: "user_ban_" + uid, style: "danger" })
    .row({ text: "Back", callback_data: "admin", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^user_linked_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  var uid = parseInt(ctx.callbackQuery.data.replace("user_linked_", ""), 10);
  var u = await User.findOne({ userId: uid }).lean();
  if (!u) return;
  var bodyText = "Wallet Number: " + (u.walletNumber || "Not Set") + "\n\nUPI: " + (u.upiId || "Not Set") + "\n\nBank: " + (u.bankAccNo || "Not Set") + "\n\nAmazon: " + (u.amazonEmail || "Not Set") + "\n\nRedeem: " + (u.redeemCodeAddr || "Not Set");
  await ctx.editMessageText("<b>Linked Withdraw Methods</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "user_detail_" + uid, style: "primary" }]] }, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^user_wd_hist_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  var uid = parseInt(ctx.callbackQuery.data.replace("user_wd_hist_", ""), 10);
  var withdrawals = await Withdrawal.find({ userId: uid }).sort({ createdAt: -1 }).limit(10).lean();
  var totalArr = await Withdrawal.aggregate([{ $match: { userId: uid, status: "Approved" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]);
  var total = totalArr[0] ? totalArr[0].total : 0;
  var approved = await Withdrawal.countDocuments({ userId: uid, status: "Approved" });
  var pending = await Withdrawal.countDocuments({ userId: uid, status: "Pending" });
  var rejected = await Withdrawal.countDocuments({ userId: uid, status: "Rejected" });
  var bodyText = "Total: " + RUPEE + total.toFixed(2) + "\n✅ " + approved + " | ⏳ " + pending + " | ❌ " + rejected + "\n\n";
  if (withdrawals.length === 0) bodyText += "No withdrawals";
  else withdrawals.forEach(function(w, i) { var icon = w.status === "Approved" ? "✅" : (w.status === "Rejected" ? "❌" : "⏳"); bodyText += (i + 1) + ". " + icon + " " + RUPEE + w.amount + " — " + w.method + "\n" + formatDateTime(w.createdAt) + "\n\n"; });
  await ctx.editMessageText("<b>Withdraw History</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "user_detail_" + uid, style: "primary" }]] }, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^user_bal_hist_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  var uid = parseInt(ctx.callbackQuery.data.replace("user_bal_hist_", ""), 10);
  var history = await BalanceHistory.find({ userId: uid }).sort({ createdAt: -1 }).limit(15).lean();
  var u = await User.findOne({ userId: uid }).lean();
  var totalIn = 0, totalOut = 0;
  history.forEach(function(h) { if (h.amount >= 0) totalIn += h.amount; else totalOut += Math.abs(h.amount); });
  var bodyText = "🟢 Credited: " + RUPEE + totalIn.toFixed(2) + "\n🔴 Debited: " + RUPEE + totalOut.toFixed(2) + "\n💵 Current: " + formatBalance(u ? u.balance : 0) + "\n\n";
  if (history.length === 0) bodyText += "No transactions";
  else history.forEach(function(h, i) { var icon = h.amount >= 0 ? "🟢" : "🔴"; var sign = h.amount >= 0 ? "+" : ""; bodyText += (i + 1) + ". " + icon + " " + h.action + "\n   " + sign + RUPEE + h.amount.toFixed(2) + "\n" + formatDateTime(h.createdAt) + "\n\n"; });
  await ctx.editMessageText("<b>Balance History</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "user_detail_" + uid, style: "primary" }]] }, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^user_add_bal_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  var uid = parseInt(ctx.callbackQuery.data.replace("user_add_bal_", ""), 10);
  userState[ctx.from.id] = "UADD_WAIT_" + uid;
  await ctx.editMessageText("➕ Send amount to add to <code>" + uid + "</code>:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "user_detail_" + uid, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^user_rem_bal_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  var uid = parseInt(ctx.callbackQuery.data.replace("user_rem_bal_", ""), 10);
  userState[ctx.from.id] = "UREM_WAIT_" + uid;
  await ctx.editMessageText("➖ Send amount to remove from <code>" + uid + "</code>:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "user_detail_" + uid, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^user_send_msg_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  var uid = parseInt(ctx.callbackQuery.data.replace("user_send_msg_", ""), 10);
  userState[ctx.from.id] = "UMSG_WAIT_" + uid;
  await ctx.editMessageText("💬 Send message to <code>" + uid + "</code>:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "user_detail_" + uid, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^user_ban_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  var uid = parseInt(ctx.callbackQuery.data.replace("user_ban_", ""), 10);
  var u = await User.findOne({ userId: uid });
  if (!u) return;
  u.isBanned = !u.isBanned;
  await u.save();
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", u.isBanned ? "User Banned" : "User Unbanned", String(uid), 0, uid);
  await ctx.answerCallbackQuery({ text: u.isBanned ? "Banned" : "Unbanned" }).catch(() => { });
});

bot.callbackQuery(/^fund_verify_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id)) && !(await isOwner(ctx.from.id))) return ctx.answerCallbackQuery({ text: "❌ Unauthorized!", show_alert: true }).catch(() => { });
  var uid = parseInt(ctx.callbackQuery.data.replace("fund_verify_", ""), 10);
  var history = await BalanceHistory.find({ userId: uid }).sort({ createdAt: -1 }).limit(30).lean();
  var bodyText = "";
  if (history.length === 0) bodyText = "No transactions.";
  else history.forEach(function(h) { var icon = h.amount >= 0 ? "✅" : "📤"; var sign = h.amount >= 0 ? "+" : ""; bodyText += icon + " " + h.action + "   " + sign + RUPEE + Math.abs(h.amount).toFixed(2) + "\n"; });
  await ctx.reply("💰 <b>Fund Verify</b>\n\n<blockquote>" + bodyText + "</blockquote>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Close", callback_data: "noop", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery(/^track_status_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id)) && !(await isOwner(ctx.from.id))) return ctx.answerCallbackQuery({ text: "❌ Unauthorized!", show_alert: true }).catch(() => { });
  var wdId = ctx.callbackQuery.data.replace("track_status_", "");
  var wd = await Withdrawal.findOne({ withdrawalId: wdId }).lean();
  if (!wd) return ctx.answerCallbackQuery({ text: "Not found", show_alert: true }).catch(() => { });
  var taxAmount = wd.taxAmount || 0;
  var netAmount = wd.netAmount || (wd.amount - taxAmount);
  var bodyText = "Request ID : #" + wd.userWithdrawalCount + "\nUser : " + wd.userId + "\nAmount : " + RUPEE + wd.amount.toFixed(2) + "\nAfter Tax : " + RUPEE + netAmount.toFixed(2) + "\n\n";
  if (wd.status === "Approved") bodyText += "Status : ✅ Approved\nApproved by " + (wd.approvedBy || "Admin") + "\nat " + formatDateTime(wd.approvedAt || wd.createdAt) + "\nTXN ID : " + wd.txnNumber;
  else if (wd.status === "Rejected") bodyText += "Status : ❌ Rejected\nRejected by " + (wd.approvedBy || "Admin") + "\nat " + formatDateTime(wd.approvedAt || wd.createdAt) + "\nRefunded : " + RUPEE + wd.amount.toFixed(2);
  else bodyText += "Status : ⏳ Pending\nWaiting for admin approval...";
  await ctx.reply("🔍 <b>Track Status</b>\n\n<blockquote>" + bodyText + "</blockquote>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Close", callback_data: "noop", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_broadcast", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "BROADCAST_WAIT_MSG";
  global.broadcastCache = global.broadcastCache || {};
  delete global.broadcastCache[ctx.from.id];
  await renderBroadcastPage(ctx);
});

async function renderBroadcastPage(ctx) {
  var cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  var broadcasts = await Broadcast.find({ createdAt: { $gte: cutoff }, status: "Completed" }).sort({ createdAt: -1 }).limit(15).lean();
  var text = "📢 <b>Broadcast Setup</b>\n\n<b>Step 1 — Send Your Message</b>\nWrite your message just like a normal Telegram chat.\n\nYou can use Telegram's built-in formatting:\n• <b>Bold</b> • <i>Italic</i> • <u>Underline</u> • <s>Strike</s> • <code>Mono</code>\n• <a href=\"https://t.me\">Clickable Links</a> • <tg-spoiler>Spoiler</tg-spoiler>\n<blockquote>Quote 💬</blockquote>\n\n<i>No HTML or coding is required.</i>\nThe bot will send the message exactly as you format it. ✅\n\n<b>Step 2 — Choose a Send Mode</b>\n🚀 Direct Mode — Clean message (no forwarding tag)\n🔄 Forward Mode — Shows Forwarded from channel\n\n👉 <b>Now, send your message below</b> 👇";
  var kb = new InlineKeyboard();
  for (var i = 0; i < broadcasts.length; i++) {
    var b = broadcasts[i];
    var preview = getBroadcastPreview(b);
    var timeAgo = formatTimeAgo(b.createdAt);
    var label = preview + " — " + timeAgo;
    if (label.length > 40) label = label.substring(0, 38) + "..";
    kb.row({ text: label, callback_data: "bc_view_" + b.broadcastId, style: "primary" });
  }
  kb.row({ text: "Back", callback_data: "admin", style: "primary" });
  if (ctx.callbackQuery) await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
  else await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

function getBroadcastPreview(b) {
  if (b.messageType === "text") {
    var content = (b.content || "").replace(/<[^>]*>/g, "").trim();
    if (!content) return "📢 Text";
    return content.length > 25 ? content.substring(0, 25) + "..." : content;
  }
  var icons = { photo: "📸 Photo", video: "🎬 Video", audio: "🎵 Audio", document: "📄 Document", sticker: "🎨 Sticker", voice: "🎤 Voice", animation: "🎬 GIF", forward: "🔄 Forward" };
  return icons[b.messageType] || "📢 Broadcast";
}

async function renderBroadcastConfirm(ctx, cacheObj) {
  var mode = cacheObj.mode || "direct";
  var modeIcon = mode === "direct" ? "🚀" : "🔄";
  var modeText = mode === "direct" ? "DIRECT MODE" : "FORWARD MODE";
  var modeDesc = mode === "direct" ? "Clean broadcast, no forwarding tag" : "Shows 'Forwarded from channel' tag";
  var buttonCount = 0;
  if (cacheObj.buttonRows) buttonCount = cacheObj.buttonRows.reduce(function(s, r) { return s + r.length; }, 0);
  var buttonText = buttonCount > 0 ? "✅ " + buttonCount + " Buttons" : "❌ No Buttons";
  var typeText = (cacheObj.type || "text").toUpperCase();
  var text = "⚠️ <b>Confirm Broadcast</b>\n\n<b>Type:</b> " + typeText + "\n<b>Mode:</b> " + modeIcon + " <b>" + modeText + "</b> (" + modeDesc + ")\n<b>Buttons:</b> " + buttonText + "\n\n<i>Select mode then click Confirm:</i>\n• 🚀 Direct Mode: Fast, clean (recommended)\n• 🔄 Forward Mode: Shows 'Forwarded from channel' tag\n\n<b>Do you want to send this message to all users?</b>";
  var directBtn = mode === "direct" ? "✅ Direct Mode" : "Direct Mode";
  var forwardBtn = mode === "forward" ? "✅ Forward Mode" : "Forward Mode";
  var kb = new InlineKeyboard()
    .row({ text: directBtn, callback_data: "broadcast_mode_direct", style: "success" }, { text: forwardBtn, callback_data: "broadcast_mode_forward", style: "primary" })
    .row({ text: "Add Buttons", callback_data: "broadcast_add_buttons", style: "primary" })
    .row({ text: "Confirm & Send", callback_data: "broadcast_confirm_send", style: "success" }, { text: "Cancel", callback_data: "broadcast_cancel", style: "danger" })
    .row({ text: "Back", callback_data: "adm_broadcast", style: "primary" });
  if (ctx.callbackQuery) await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
  else await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("broadcast_mode_direct", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var userId = ctx.from.id;
  if (!global.broadcastCache || !global.broadcastCache[userId]) return ctx.answerCallbackQuery({ text: "Expired!", show_alert: true }).catch(() => { });
  global.broadcastCache[userId].mode = "direct";
  await ctx.answerCallbackQuery({ text: "🚀 Direct Mode" }).catch(() => { });
  await renderBroadcastConfirm(ctx, global.broadcastCache[userId]);
});

bot.callbackQuery("broadcast_mode_forward", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var userId = ctx.from.id;
  if (!global.broadcastCache || !global.broadcastCache[userId]) return ctx.answerCallbackQuery({ text: "Expired!", show_alert: true }).catch(() => { });
  global.broadcastCache[userId].mode = "forward";
  await ctx.answerCallbackQuery({ text: "🔄 Forward Mode" }).catch(() => { });
  await renderBroadcastConfirm(ctx, global.broadcastCache[userId]);
});

bot.callbackQuery("broadcast_add_buttons", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "BROADCAST_ADD_BUTTONS";
  var text = "⌨️ <b>Add Inline Buttons</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n🟢 <b>Basic Format (One Button)</b>\n<code>Button Text - https://example.com</code>\n\n🟢 <b>Multiple Buttons (New Row)</b>\n<code>Join Channel - https://t.me/YourChannel\nSupport - https://t.me/YourSupport</code>\n\n🟢 <b>Two Buttons In Same Row</b>\n<code>Join - https://t.me/A && Support - https://t.me/B</code>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 <b>Rules:</b>\n• Each new line = new row\n• Use && to place buttons in same row";
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "broadcast_confirm_back", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("broadcast_confirm_back", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var userId = ctx.from.id;
  var cacheObj = global.broadcastCache && global.broadcastCache[userId];
  if (!cacheObj) return ctx.answerCallbackQuery({ text: "Expired!", show_alert: true }).catch(() => { });
  await renderBroadcastConfirm(ctx, cacheObj);
});

bot.callbackQuery("broadcast_cancel", async (ctx) => {
  var userId = ctx.from.id;
  delete userState[userId];
  if (global.broadcastCache) delete global.broadcastCache[userId];
  await ctx.answerCallbackQuery({ text: "❌ Cancelled" }).catch(() => { });
  await renderBroadcastPage(ctx);
});

bot.callbackQuery("broadcast_confirm_send", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var userId = ctx.from.id;
  var cacheObj = global.broadcastCache && global.broadcastCache[userId];
  if (!cacheObj) return ctx.answerCallbackQuery({ text: "Expired!", show_alert: true }).catch(() => { });
  if (cacheObj.confirmed) return ctx.answerCallbackQuery({ text: "Already confirmed!", show_alert: true }).catch(() => { });
  cacheObj.confirmed = true;
  var mode = cacheObj.mode || "direct";
  var modeIcon = mode === "direct" ? "🚀" : "🔄";
  var modeText = mode === "direct" ? "DIRECT MODE" : "FORWARD MODE";
  delete userState[userId];
  delete global.broadcastCache[userId];
  await ctx.answerCallbackQuery({ text: "🚀 Broadcasting..." }).catch(() => { });
  var totalUsers = await User.countDocuments({});
  await ctx.editMessageText("📢 <b>Broadcasting...</b>\n\n📢 <b>Mode:</b> " + modeIcon + " " + modeText + "\n👥 <b>Total Users:</b> " + totalUsers + "\n\n⏳ Starting...", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back to Admin", callback_data: "admin", style: "primary" }]] } }).catch(() => { });
  setImmediate(async () => { await runBroadcast(userId, ctx, cacheObj, totalUsers); });
});

async function sendBroadcastWithButtons(bot, userId, cacheObj, inlineKb) {
  var sendOpts = { parse_mode: "HTML" };
  if (inlineKb) sendOpts.reply_markup = inlineKb;
  if (cacheObj.type === "text") return await bot.api.sendMessage(userId, cacheObj.content, sendOpts);
  if (cacheObj.type === "photo") return await bot.api.sendPhoto(userId, cacheObj.fileId, Object.assign({}, sendOpts, { caption: cacheObj.caption || "" }));
  if (cacheObj.type === "video") return await bot.api.sendVideo(userId, cacheObj.fileId, Object.assign({}, sendOpts, { caption: cacheObj.caption || "" }));
  if (cacheObj.type === "audio") return await bot.api.sendAudio(userId, cacheObj.fileId, Object.assign({}, sendOpts, { caption: cacheObj.caption || "" }));
  if (cacheObj.type === "document") return await bot.api.sendDocument(userId, cacheObj.fileId, Object.assign({}, sendOpts, { caption: cacheObj.caption || "" }));
  if (cacheObj.type === "sticker") return await bot.api.sendSticker(userId, cacheObj.fileId, inlineKb ? { reply_markup: inlineKb } : {});
  if (cacheObj.type === "animation") return await bot.api.sendAnimation(userId, cacheObj.fileId, Object.assign({}, sendOpts, { caption: cacheObj.caption || "" }));
  if (cacheObj.type === "voice") return await bot.api.sendVoice(userId, cacheObj.fileId, Object.assign({}, sendOpts, { caption: cacheObj.caption || "" }));
}

async function runBroadcast(adminId, ctx, cacheObj, totalUsers) {
  try {
    var startTime = Date.now();
    var allUsers = await User.find({}).lean();
    var total = allUsers.length;
    var sent = 0, failed = 0, processed = 0;
    var mode = cacheObj.mode || "direct";
    var modeIcon = mode === "direct" ? "\uD83D\uDE80" : "\uD83D\uDD04";
    var modeText = mode === "direct" ? "DIRECT MODE" : "FORWARD MODE";
    var inlineKb = null;
    if (cacheObj.buttonRows && cacheObj.buttonRows.length > 0) inlineKb = buildInlineKeyboardFromRows(cacheObj.buttonRows);
    var statusMsg;
    try {
      statusMsg = await bot.api.sendMessage(adminId, "\uD83D\uDE80 <b>Broadcast Running...</b>\n\n\uD83D\uDCE2 <b>Mode:</b> " + modeIcon + " " + modeText + "\n\uD83D\uDC65 <b>Total:</b> " + total + "\n\n\u23F3 Starting...", { parse_mode: "HTML" });
    } catch (e) { }
    var lastUpdate = Date.now();
    var UPDATE_INTERVAL = 1500;
    for (var ui = 0; ui < allUsers.length; ui++) {
      var u = allUsers[ui];
      try {
        if (mode === "forward" && cacheObj.fromChatId && cacheObj.fromMessageId) {
          await bot.api.forwardMessage(u.userId, cacheObj.fromChatId, cacheObj.fromMessageId);
        } else {
          await sendBroadcastWithButtons(bot, u.userId, cacheObj, inlineKb);
        }
        sent++;
      } catch (e) { failed++; }
      processed++;
      var now = Date.now();
      if (now - lastUpdate > UPDATE_INTERVAL && statusMsg) {
        var elapsed = (now - startTime) / 1000;
        var speed = elapsed > 0 ? processed / elapsed : 0;
        var percent = total > 0 ? (processed / total) * 100 : 0;
        var bar = makeProgressBar(percent);
        try {
          await bot.api.editMessageText(adminId, statusMsg.message_id, "\uD83D\uDE80 <b>Broadcast Running...</b>\n\n\uD83D\uDCE2 <b>Mode:</b> " + modeIcon + " " + modeText + "\n\uD83D\uDCCA <b>Progress:</b> " + percent.toFixed(1) + "%\n" + bar + "\n\n\uD83D\uDC65 <b>Total:</b> " + total + "\n\u2705 <b>Success:</b> " + sent + "\n\u274C <b>Failed:</b> " + failed + "\n\u26A1 <b>Speed:</b> " + speed.toFixed(1) + " msg/sec", { parse_mode: "HTML" });
        } catch (e) { }
        lastUpdate = now;
      }
      await new Promise(function(r) { setTimeout(r, 40); });
    }
    var totalTime = (Date.now() - startTime) / 1000;
    var avgSpeed = totalTime > 0 ? total / totalTime : 0;
    var broadcastId = Math.floor(100000 + Math.random() * 900000).toString();
    await Broadcast.create({ broadcastId: broadcastId, adminId: adminId, adminName: "Admin", messageType: cacheObj.type || "text", content: cacheObj.content || cacheObj.caption || "", fileId: cacheObj.fileId || "", sentCount: sent, failedCount: failed, totalCount: total, timeTaken: parseFloat(totalTime.toFixed(1)), status: failed === 0 ? "Completed" : "Partial" });
    if (statusMsg) {
      try {
        await bot.api.editMessageText(adminId, statusMsg.message_id, "\u2705 <b>Broadcast Completed!</b>\n\n\uD83D\uDCE2 <b>Mode:</b> " + modeIcon + " " + modeText + "\n\uD83D\uDC65 <b>Total:</b> " + total + "\n\u2705 <b>Success:</b> " + sent + "\n\u274C <b>Failed:</b> " + failed + "\n\u26A1 <b>Avg Speed:</b> " + avgSpeed.toFixed(1) + " msg/sec\n\u23F1\uFE0F <b>Time:</b> " + totalTime.toFixed(1) + "s", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "\u2B05\uFE0F Back", callback_data: "admin", style: "primary" }]] } });
      } catch (e) { }
    }
  } catch (e) { console.error("runBroadcast error:", e.message); }
}

bot.callbackQuery(/^bc_view_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var bcId = ctx.callbackQuery.data.replace("bc_view_", "");
  var b = await Broadcast.findOne({ broadcastId: bcId }).lean();
  if (!b) return ctx.answerCallbackQuery({ text: "Not found", show_alert: true }).catch(() => { });
  var typeIcon = { text: "📝", photo: "📸", video: "🎬", audio: "🎵", document: "📄", sticker: "🎨", voice: "🎤", animation: "🎬", forward: "🔄" }[b.messageType] || "📢";
  var bodyText = typeIcon + " Type: " + b.messageType + "\n👥 Sent: " + b.sentCount + "\n❌ Failed: " + b.failedCount + "\n📊 Total: " + b.totalCount + "\n⏱️ Time: " + b.timeTaken + "s\n🕐 " + formatDateTime(b.createdAt) + "\n";
  if (b.content) bodyText += "\nContent:\n" + b.content;
  var kb = new InlineKeyboard().row({ text: "🗑️ Delete", callback_data: "bc_del_" + bcId, style: "danger" }).row({ text: "Back", callback_data: "adm_broadcast", style: "primary" });
  await ctx.editMessageText("📢 <b>Broadcast Details</b>\n\n<blockquote>" + bodyText + "</blockquote>", { parse_mode: "HTML", reply_markup: kb }).catch(() => { });
});

bot.callbackQuery(/^bc_del_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var bcId = ctx.callbackQuery.data.replace("bc_del_", "");
  await Broadcast.deleteOne({ broadcastId: bcId });
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Broadcast Deleted", bcId, 0, null);
  await ctx.answerCallbackQuery({ text: "🗑️ Deleted!" }).catch(() => { });
  await renderBroadcastPage(ctx);
});

bot.command("start", async (ctx) => {
  try {
    delete userState[ctx.from.id];
    var userId = ctx.from.id;
    var existingUser = await User.findOne({ userId }).lean();
    var isNewUser = !existingUser;
    var user = await getUser(userId);
    user.firstName = ctx.from.first_name || "";
    user.lastName = ctx.from.last_name || "";
    user.username = ctx.from.username || "";
    await user.save();
    if (isNewUser) {
      await NewUserLog.findOneAndUpdate({ userId }, { firstName: ctx.from.first_name || "", username: ctx.from.username || "", startTime: new Date() }, { upsert: true });
      var nameStr = ((ctx.from.first_name || "") + " " + (ctx.from.last_name || "")).trim() || "No Name";
      var usernameStr = ctx.from.username ? "@" + ctx.from.username : "No Username";
      var notifMsg = "🆕 <b>New User Started Bot!</b>\n\n👤 " + nameStr + "\n🆔 <code>" + userId + "</code>\n📛 " + usernameStr + "\n💰 " + RUPEE + user.balance.toFixed(2) + "\n📅 " + formatDateTime(new Date());
      var profileKb = { inline_keyboard: [[{ text: "👤 Open Profile", url: "tg://user?id=" + userId, style: "primary" }]] };
      var newUserNotif = await getConfig("new_user_notif", true);
      if (newUserNotif) {
        try { await ctx.api.sendMessage(MAIN_OWNER_ID, notifMsg, { parse_mode: "HTML", reply_markup: profileKb }).catch(() => { }); } catch (e) { }
      }
    }
    if (user.isBanned) return ctx.reply("You are banned from using this bot.").catch(() => { });
    var botStatus = await getConfig("bot_status", "active");
    if (botStatus === "maintenance" || botStatus === "disabled") {
      var isAdminUser = await isAdmin(userId);
      if (!isAdminUser) {
        var botOffText;
        if (botStatus === "maintenance") botOffText = await getConfig("bot_maintenance_text", "⚠️ Bot is under maintenance. Please try again later.");
        else botOffText = await getConfig("bot_off_text", "❌ Bot is currently disabled.");
        return ctx.reply(botOffText, { parse_mode: "HTML" }).catch(() => { });
      }
    }
    var isJoined = await checkForceJoin(ctx);
    if (!isJoined) return sendForceJoinMessage(ctx);
    var titleText = await getConfig("start_title_text", DEFAULT_START_TEXT.title);
    var linkPrefix = await getConfig("start_link_prefix", DEFAULT_START_TEXT.linkPrefix);
    var linkClickable = await getConfig("start_link_clickable", DEFAULT_START_TEXT.linkClickable);
    var welcomeLink = await getConfig("welcome_channel_link", "https://t.me/yourchannel");
    var finalLink = convertOwnerLink(welcomeLink);
    var welcomeText = titleText + "\n\n" + linkPrefix + '<a href="' + finalLink + '">' + linkClickable + "</a>";
    var socialLinks = await SocialLink.find({}).lean();
    if (socialLinks.length > 0) {
      welcomeText += "\n\n";
      for (var i = 0; i < socialLinks.length; i++) welcomeText += '<a href="' + socialLinks[i].link + '">' + socialLinks[i].name + "</a>  ";
    }
    try {
      await ctx.reply(welcomeText, { reply_markup: await buildKeyboardFromLayout(userId), parse_mode: "HTML" });
    } catch (htmlErr) {
      await ctx.reply(titleText + "\n\n" + linkPrefix + linkClickable + "\n" + finalLink, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
    }
  } catch (err) {
    try { await ctx.reply("❌ Error: " + err.message).catch(() => { }); } catch (e) { }
  }
});

async function sendForceJoinMessage(ctx) {
  var channels = await Channel.find({ isActive: true, isHidden: { $ne: true } }).sort({ order: 1, addedAt: 1 }).lean();
  if (!channels || channels.length === 0) return null;
  var userId = ctx.from.id;
  var showMode = await getConfig("show_mode", "all");
  var displayChannels = [];
  var notJoinedCount = 0;
  for (var i = 0; i < channels.length; i++) {
    var ch = channels[i];
    var isJoined = false;
    try {
      var member = await ctx.api.getChatMember(ch.channelId, userId);
      if (["member", "administrator", "creator"].indexOf(member.status) >= 0) isJoined = true;
    } catch (e) { }
    if (!isJoined) notJoinedCount++;
    if (showMode === "all" || !isJoined) displayChannels.push(Object.assign({}, ch, { isJoined: isJoined }));
  }
  if (displayChannels.length === 0) return null;
  var title = "\u26A0\uFE0F " + toSmallCaps("You Must Join Our Channels!");
  var bodyText = "\uD83D\uDC47 " + toSmallCaps("Join all channels below") + ":";
  var text = title + "\n\n<blockquote>" + bodyText + "</blockquote>";
  if (notJoinedCount > 0) text += "\n\n" + toSmallCaps("You have not joined in " + notJoinedCount + " channels");
  var rows = [];
  for (var j = 0; j < displayChannels.length; j++) {
    var dch = displayChannels[j];
    rows.push([{ text: "\uD83D\uDCE2 " + (dch.displayName || dch.channelId), url: dch.inviteLink, style: dch.isJoined ? "success" : "danger" }]);
  }
  rows.push([{ text: "\u2705 Claim", callback_data: "check_join", style: "success" }]);
  return ctx.reply(text, { reply_markup: { inline_keyboard: rows }, parse_mode: "HTML" }).catch(function() { });
}

bot.callbackQuery("check_join", async (ctx) => {
  var userId = ctx.from.id;
  var isJoined = await checkForceJoin(ctx);
  if (!isJoined) {
    await ctx.answerCallbackQuery({ text: "You must join all channels first!", show_alert: true }).catch(() => { });
    await ctx.deleteMessage().catch(() => { });
    await sendForceJoinMessage(ctx);
    return;
  }
  await ctx.answerCallbackQuery({ text: "Verified!" }).catch(() => { });
  await ctx.deleteMessage().catch(() => { });
  await ctx.reply("✅ " + toSmallCaps("Verified!") + "\n\n" + toSmallCaps("Welcome to the bot!"), { parse_mode: "HTML", reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
});

global.lastBalance = global.lastBalance || {};

async function sendBalancePage(ctx, edit, animate) {
  if (edit === undefined) edit = false;
  if (animate === undefined) animate = true;
  try {
    var userId = ctx.from.id;
    var user = await getUser(userId);
    var newBalance = user.balance;
    var welcomeText = await getConfig("balance_welcome_text", DEFAULT_BALANCE_TEXT.welcome);
    var footerText = await getConfig("balance_footer_text", DEFAULT_BALANCE_TEXT.footer);
    welcomeText = String(welcomeText || DEFAULT_BALANCE_TEXT.welcome);
    footerText = String(footerText || DEFAULT_BALANCE_TEXT.footer);
    var startBalance = 0;
    var isRefresh = animate && ctx.callbackQuery && ctx.callbackQuery.data === "refresh_balance_only";
    if (isRefresh && global.lastBalance[userId] !== undefined) startBalance = global.lastBalance[userId];
    global.lastBalance[userId] = newBalance;
    var balanceDisplay = formatBalance(newBalance);
    var msg = welcomeText + "\n\n🔵 " + toSmallCaps("Wallet ID") + " ➝ <code>" + userId + "</code>\n🧾 " + toSmallCaps("Balance") + " ➝ <code>" + balanceDisplay + "</code>\n\n<blockquote>" + footerText + "</blockquote>";
    var inlineStyles = await getConfig("inline_button_styles", {});
    var depositEnabled = await getConfig("deposit_enabled", false);
    var buttons = [];
    if (depositEnabled) buttons.push([{ text: "💰 " + toSmallCaps("Deposit"), callback_data: "user_deposit", style: inlineStyles["deposit"] || "primary" }]);
    buttons.push([
      { text: "📊 " + toSmallCaps("Balance Statement"), callback_data: "balance_statement", style: inlineStyles["balance_statement"] || "primary" },
      { text: "💰 " + toSmallCaps("Live Fund"), callback_data: "live_fund", style: inlineStyles["live_fund"] || "primary" }
    ]);
    buttons.push([{ text: "🔄 " + toSmallCaps("Refresh"), callback_data: "refresh_balance_only", style: inlineStyles["refresh_balance_only"] || "primary" }]);
    var kb = { inline_keyboard: buttons };
    var shouldAnimate = animate && newBalance > 0 && startBalance !== newBalance;
    if (shouldAnimate) {
      var messageId = null;
      var chatId = ctx.chat.id;
      if (edit && ctx.callbackQuery) {
        messageId = ctx.callbackQuery.message.message_id;
      } else {
        var initialMsg = msg.replace(RUPEE + "[\d,]+\.\d{2}/, RUPEE + "0.00");
        var sent = await ctx.reply(msg, { reply_markup: kb, parse_mode: "HTML" }).catch(function() { return null; });
        if (!sent) return;
        messageId = sent.message_id;
      }
      if (messageId) {
        var steps = 8;
        var diff = newBalance - startBalance;
        for (var i = 1; i <= steps; i++) {
          var progress = i / steps;
          var eased = 1 - Math.pow(1 - progress, 3);
          var currentBalance = startBalance + (diff * eased);
          var animMsg = msg.replace(RUPEE + "[\d,]+\.\d{2}/, RUPEE + currentBalance.toFixed(2));
          try {
            await ctx.api.editMessageText(chatId, messageId, animMsg, { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
          } catch (e) { }
          await new Promise(function(r) { setTimeout(r, 100); });
        }
        await ctx.api.editMessageText(chatId, messageId, msg, { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
        return;
      }
    }
    try {
      if (edit && ctx.callbackQuery) await ctx.editMessageText(msg, { reply_markup: kb, parse_mode: "HTML" });
      else await ctx.reply(msg, { reply_markup: kb, parse_mode: "HTML" });
    } catch (htmlErr) {
      var plainWelcome = String(welcomeText).replace(/<[^>]*>/g, "");
      var plainFooter = String(footerText).replace(/<[^>]*>/g, "");
      var plainMsg = plainWelcome + "\n\n🔵 Wallet ID ➝ " + userId + "\n🧾 Balance ➝ " + balanceDisplay + "\n\n" + plainFooter;
      if (edit && ctx.callbackQuery) await ctx.editMessageText(plainMsg, { reply_markup: kb }).catch(() => { });
      else await ctx.reply(plainMsg, { reply_markup: kb }).catch(() => { });
    }
  } catch (e) {
    console.error("sendBalancePage error:", e.message);
    try { await ctx.reply("💰 Balance: " + RUPEE + (await getUser(ctx.from.id)).balance.toFixed(2)).catch(() => { }); } catch (_) { }
  }
}

async function sendPayoutMethodPage(ctx, edit) {
  if (edit === undefined) edit = false;
  try {
    var userId = ctx.from.id;
    var user = await getUser(userId);
    var fmt = function(val) { return (val && val !== "Not Set" && String(val).trim() !== "") ? String(val) : "Not Set"; };
    var upiWs = await WithdrawSettings.findOne({ method: "upi" }).lean();
    var bankWs = await WithdrawSettings.findOne({ method: "bank" }).lean();
    var showUPI = upiWs ? upiWs.isActive : false;
    var showBank = bankWs ? bankWs.isActive : false;
    var msg = "<b>" + toSmallCaps("Payout Method") + "</b>\n\n";
    if (showUPI) msg += toSmallCaps("UPI") + " : " + fmt(user.upiId) + "\n\n";
    msg += toSmallCaps("Set Wallet") + " : " + fmt(user.walletNumber) + "\n\n";
    if (showBank) msg += toSmallCaps("Bank") + " : " + ((user.bankAccNo !== "Not Set") ? (user.bankAccNo + " (" + user.bankIfsc + ")") : "Not Set") + "\n";
    var kb = new InlineKeyboard();
    if (showUPI) kb.row({ text: "Set UPI", callback_data: "set_upi", style: "primary" });
    kb.row({ text: "Set Wallet", callback_data: "set_wallet_number", style: "primary" });
    if (showBank) kb.row({ text: "Set Bank", callback_data: "set_bank", style: "primary" });
    if (edit && ctx.callbackQuery) await ctx.editMessageText(msg, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
    else await ctx.reply(msg, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
  } catch (e) { console.error("sendPayoutMethodPage:", e.message); }
}

bot.callbackQuery("set_upi", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  userState[ctx.from.id] = "SET_UPI_ACC";
  await ctx.editMessageText("📝 Send your UPI ID:\n\nExample: <code>yourname@upi</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "btn_payout_back", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("set_wallet_number", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  userState[ctx.from.id] = "SET_WALLET_NUMBER";
  await ctx.editMessageText("📝 Send your Wallet Number (10-12 digits):", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "btn_payout_back", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("set_bank", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  userState[ctx.from.id] = "SET_BANK_ACCNO";
  await ctx.editMessageText("🏦 Send Your Bank Account Number (9-18 digits):", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "btn_payout_back", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("btn_payout_back", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  delete userState[ctx.from.id];
  await sendPayoutMethodPage(ctx, true);
});

bot.callbackQuery("back_to_withdraw", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  delete userState[ctx.from.id];
  var buttons = await buildWithdrawMenu();
  if (buttons.length === 0) {
    return ctx.editMessageText("<b>" + toSmallCaps("Choose Withdraw Method") + "</b>\n\n❌ " + toSmallCaps("No withdraw methods available."), { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "back_to_balance", style: "primary" }]] } }).catch(() => { });
  }
  await ctx.editMessageText("<b>" + toSmallCaps("Choose Withdraw Method") + "</b>", { reply_markup: { inline_keyboard: buttons }, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("wd_cancel", async (ctx) => {
  ctx.answerCallbackQuery({ text: "Cancelled" }).catch(() => { });
  delete userState[ctx.from.id];
  await sendBalancePage(ctx, true, false);
});

async function buildWithdrawMenu() {
  var buttons = [];
  var gateways = await Gateway.find({ isActive: true }).sort({ createdAt: 1 }).lean();
  for (var i = 0; i < gateways.length; i++) buttons.push([{ text: gateways[i].name.toUpperCase(), callback_data: "wd_gw_" + gateways[i].name, style: "primary" }]);
  var autoUpis = await AutoUpi.find({ status: "active" }).sort({ order: 1, createdAt: 1 }).lean();
  for (var j = 0; j < autoUpis.length; j++) buttons.push([{ text: "⚡ " + autoUpis[j].name + " (Auto UPI)", callback_data: "wd_auto_" + autoUpis[j].gatewayId, style: "primary" }]);
  var autoBanks = await AutoBank.find({ status: "active" }).lean();
  for (var k = 0; k < autoBanks.length; k++) buttons.push([{ text: "🏦 " + autoBanks[k].name + " (Auto Bank)", callback_data: "wd_bank_" + autoBanks[k].gatewayId, style: "primary" }]);
  var methods = ["upi", "bank", "amazon", "redeem"];
  for (var m = 0; m < methods.length; m++) {
    var s = await WithdrawSettings.findOne({ method: methods[m] }).lean();
    if (s && s.isActive) buttons.push([{ text: methods[m].toUpperCase(), callback_data: "wd_" + methods[m], style: "primary" }]);
  }
  return buttons;
}

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
  var userId = ctx.from.id;
  await ctx.answerCallbackQuery().catch(() => { });
  var history = await BalanceHistory.find({ userId }).sort({ createdAt: -1 }).limit(30).lean();
  var user = await getUser(userId);
  var bodyText = toSmallCaps("Wallet ID") + ": " + userId + "\n" + toSmallCaps("Balance") + ": " + formatBalance(user.balance) + "\n\n";
  if (history.length === 0) bodyText += "📭 No transactions.";
  else {
    var totalIn = 0, totalOut = 0;
    history.forEach(function(h) {
      var icon = h.amount >= 0 ? "🟢" : "🔴";
      var sign = h.amount >= 0 ? "+" : "";
      bodyText += icon + " " + h.action + "\n   " + sign + RUPEE + h.amount.toFixed(2) + " • " + formatDateTime(h.createdAt) + "\n\n";
      if (h.amount >= 0) totalIn += h.amount; else totalOut += Math.abs(h.amount);
    });
    bodyText += "━━━━━━━━━━━━━━━━━━━━\n🟢 Earned: " + RUPEE + totalIn.toFixed(2) + "\n🔴 Spent: " + RUPEE + totalOut.toFixed(2);
  }
  var kb = new InlineKeyboard().row({ text: "Refresh", callback_data: "balance_statement", style: "primary" }).row({ text: "Back", callback_data: "back_to_balance", style: "primary" });
  await ctx.editMessageText("<b>" + toSmallCaps("Balance Statement") + "</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("noop", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "OK" }).catch(() => { });
});

bot.callbackQuery("live_fund", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Loading..." }).catch(() => { });
  var users = await User.find({}).lean();
  var totalBalance = 0;
  users.forEach(function(u) { totalBalance += u.balance; });
  var liveFund = await LiveFund.findOne({ key: "main_fund" }).lean();
  var bodyText = "Users: " + users.length + "\nTotal: " + RUPEE + totalBalance.toFixed(2);
  if (liveFund && liveFund.isActive) {
    var running = (liveFund.totalFund || 0) - (liveFund.usedFund || 0);
    bodyText += "\n\nLive Fund:\n💰 Set Fund: " + RUPEE + (liveFund.totalFund || 0).toFixed(2) + "\n📉 Running: " + RUPEE + running.toFixed(2) + "\n📊 Used: " + RUPEE + (liveFund.usedFund || 0).toFixed(2);
  }
  var kb = new InlineKeyboard().row({ text: "Refresh", callback_data: "live_fund", style: "primary" }).row({ text: "Back", callback_data: "back_to_balance", style: "primary" });
  await ctx.editMessageText("<b>" + toSmallCaps("Live Fund Report") + "</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("user_deposit", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  var depositEnabled = await getConfig("deposit_enabled", false);
  if (!depositEnabled) {
    var msg = await getConfig("deposit_message", "Deposit is currently unavailable. Please contact support.");
    return ctx.editMessageText("⚠️ <b>Deposit</b>\n\n" + msg, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "back_to_balance", style: "primary" }]] } }).catch(() => { });
  }
  return ctx.editMessageText("⚠️ <b>Deposit</b>\n\nDeposit service unavailable.", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "back_to_balance", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery(/^wd_gw_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  var userId = ctx.from.id;
  var gwName = ctx.callbackQuery.data.replace("wd_gw_", "");
  var gateway = await Gateway.findOne({ name: gwName, isActive: true });
  if (!gateway) return ctx.answerCallbackQuery({ text: "Gateway not available", show_alert: true }).catch(() => { });
  var user = await getUser(userId);
  var wallet = user.walletNumber || "";
  if (!wallet) {
    userState[userId] = "GW_NUMBER_" + gwName;
    var kb = new Keyboard().text("Cancel").resized().oneTime();
    return ctx.reply("📝 Send Your Wallet Number (10-12 digits):", { reply_markup: kb }).catch(() => { });
  }
  userState[userId] = "GW_AMOUNT_" + gwName;
  var kb2 = new Keyboard().text("Cancel").resized().oneTime();
  await ctx.reply("Enter Withdraw Amount", { reply_markup: kb2 }).catch(() => { });
});

bot.callbackQuery(/^gw_conf_yes_/, async (ctx) => {
  try {
    var userId = ctx.from.id;
    var data = ctx.callbackQuery.data.replace("gw_conf_yes_", "");
    var parts = data.split("_");
    var amount = parseFloat(parts.pop());
    var gwName = parts.join("_");
    await ctx.answerCallbackQuery({ text: "Processing..." }).catch(() => { });
    delete userState[userId];
    var user = await getUser(userId);
    var gateway = await Gateway.findOne({ name: gwName, isActive: true });
    if (!gateway) return ctx.editMessageText("❌ Gateway not found.", { parse_mode: "HTML" }).catch(() => { });
    var minW = gateway.minAmount || 0;
    var maxW = gateway.maxAmount || 0;
    if (minW > 0 && amount < minW) return ctx.editMessageText("❌ Minimum: " + RUPEE + minW, { parse_mode: "HTML" }).catch(() => { });
    if (maxW > 0 && amount > maxW) return ctx.editMessageText("❌ Maximum: " + RUPEE + maxW, { parse_mode: "HTML" }).catch(() => { });
    if (user.balance < amount) return ctx.editMessageText("❌ Insufficient balance!", { parse_mode: "HTML" }).catch(() => { });
    var wallet = user.walletNumber || "";
    if (!wallet) return ctx.editMessageText("❌ Number not saved!", { parse_mode: "HTML" }).catch(() => { });
    var taxAmount = calculateFixedTax(amount, gateway.taxSlabs || []);
    var payoutAmount = amount - taxAmount;
    var oldBalance = user.balance;
    user.balance -= amount;
    user.withdrawnTotal = (user.withdrawnTotal || 0) + amount;
    await user.save();
    await logBalanceHistory(userId, "Withdrawn via " + gwName + " (Bot)", -amount);
    if (taxAmount > 0) {
      var ownerId = await getConfig("owner_id", MAIN_OWNER_ID);
      await User.findOneAndUpdate({ userId: ownerId }, { $inc: { balance: taxAmount } });
      await logBalanceHistory(ownerId, "Withdrawal Tax (" + gwName + ")", taxAmount);
    }
    var approvedCount = await Withdrawal.countDocuments({ userId: userId, status: "Approved" });
    var userWithdrawalCount = approvedCount + 1;
    var withdrawalId = Math.floor(100000 + Math.random() * 900000).toString();
    var payoutChannel = await getMethodPayoutChannel(gwName, gateway);
    var channelList = payoutChannel && payoutChannel !== "Not Set" ? [payoutChannel] : [];
    var msgId = ctx.callbackQuery.message.message_id;
    var chatId = ctx.chat.id;
    await ctx.editMessageText("⏳ Processing " + buildProcessingDots(0), { parse_mode: "HTML" }).catch(() => { });
    var animFrame = 1;
    var animInterval = setInterval(async function() {
      try { await ctx.api.editMessageText(chatId, msgId, "⏳ Processing " + buildProcessingDots(animFrame), { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
      animFrame++;
    }, 400);
    var result = await processGatewayPayout({ bot: bot, userId: userId, amount: amount, payoutAmount: payoutAmount, gatewayInfo: gateway, wallet: wallet, channelList: channelList, showRemainingBalance: true });
    clearInterval(animInterval);
    if (result.status === "success") {
      var txnNumber = result.txnNumber || generateTxnNumber();
      var processTime = new Date();
      await Withdrawal.create({ withdrawalId: withdrawalId, userId: userId, userWithdrawalCount: userWithdrawalCount, amount: amount, method: gwName, details: wallet, status: "Approved", isGateway: true, gatewayName: gateway.name, gatewayResponse: result.rawResponse || "", txnNumber: txnNumber, taxAmount: taxAmount, netAmount: payoutAmount, oldBalance: oldBalance, newBalance: user.balance, approvedBy: "Auto Gateway", approvedAt: processTime });
      await LiveFund.findOneAndUpdate({ key: "main_fund" }, { $inc: { usedFund: amount } }, { upsert: true });
      var serverUrl = process.env.RENDER_EXTERNAL_URL || ("http://localhost:" + PORT);
      if (serverUrl.indexOf("http") !== 0) serverUrl = "https://" + serverUrl;
      var receiptUrl = serverUrl + "/receipt/" + withdrawalId;
      var maskedWallet = halfMaskWallet(wallet);
      var successMsg = buildSuccessMessage(payoutAmount, maskedWallet, txnNumber, processTime, gateway.name);
      await ctx.api.editMessageText(chatId, msgId, successMsg, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "✅ Check Status", url: receiptUrl, style: "success" }]] } }).catch(() => { });
      var restoreKb = await buildKeyboardFromLayout(userId);
      await ctx.reply(" ", { reply_markup: restoreKb }).then(function(m) { return ctx.api.deleteMessage(chatId, m.message_id).catch(() => { }); }).catch(() => { });
    } else {
      user.balance += amount;
      user.withdrawnTotal = Math.max(0, (user.withdrawnTotal || 0) - amount);
      await user.save();
      await logBalanceHistory(userId, "Withdrawal Failed (Refunded)", amount);
      await ctx.api.editMessageText(chatId, msgId, "❌ <b>Withdrawal Failed</b>\n\nAmount: " + RUPEE + amount.toFixed(2) + "\nGateway: " + gateway.name + "\nReason: " + (result.message || "Gateway error") + "\n\n💵 Refunded: " + RUPEE + user.balance.toFixed(2), { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Menu", callback_data: "back_to_balance", style: "primary" }]] } }).catch(() => { });
    }
  } catch (e) { console.error("gw_conf_yes_ error:", e.message); }
});

bot.callbackQuery("gw_conf_no", async (ctx) => {
  ctx.answerCallbackQuery({ text: "Cancelled" }).catch(() => { });
  delete userState[ctx.from.id];
  await sendBalancePage(ctx, true, false);
});

bot.callbackQuery(/^wd_auto_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  var userId = ctx.from.id;
  var gwId = ctx.callbackQuery.data.replace("wd_auto_", "");
  var gw = await AutoUpi.findOne({ gatewayId: gwId, status: "active" });
  if (!gw) return ctx.answerCallbackQuery({ text: "Not available", show_alert: true }).catch(() => { });
  var user = await getUser(userId);
  if (!user.upiId || user.upiId === "Not Set") {
    return ctx.editMessageText("❌ <b>UPI Not Linked</b>\n\nPlease link UPI from Payout Method first.", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Payout Method", callback_data: "btn_payout_back", style: "primary" }, { text: "Back", callback_data: "back_to_withdraw", style: "primary" }]] } }).catch(() => { });
  }
  userState[userId] = "MANUAL_AMOUNT_auto_upi_" + gwId;
  var kb = new Keyboard().text("Cancel").resized().oneTime();
  await ctx.reply("Enter Withdraw Amount", { reply_markup: kb }).catch(() => { });
});

bot.callbackQuery("auto_upi_cancel", async (ctx) => {
  ctx.answerCallbackQuery({ text: "Cancelled" }).catch(() => { });
  delete userState[ctx.from.id];
  await sendBalancePage(ctx, true, false);
});

bot.callbackQuery(/^auto_upi_confirm_/, async (ctx) => {
  try {
    var data = ctx.callbackQuery.data.replace("auto_upi_confirm_", "");
    var parts = data.split("_");
    var amount = parseFloat(parts.pop());
    var gwId = parts.join("_");
    await ctx.answerCallbackQuery({ text: "Processing..." }).catch(() => { });
    var userId = ctx.from.id;
    delete userState[userId];
    var user = await getUser(userId);
    var gw = await AutoUpi.findOne({ gatewayId: gwId, status: "active" });
    if (!gw) return ctx.editMessageText("❌ Gateway not available", { parse_mode: "HTML" }).catch(() => { });
    if (user.balance < amount) return ctx.editMessageText("❌ Insufficient balance", { parse_mode: "HTML" }).catch(() => { });
    var upiId = user.upiId;
    if (!upiId || upiId === "Not Set") return ctx.editMessageText("❌ UPI not linked", { parse_mode: "HTML" }).catch(() => { });
    var taxAmount = calculateFixedTax(amount, gw.taxSlabs || []);
    var payoutAmount = amount - taxAmount;
    var oldBalance = user.balance;
    user.balance -= amount;
    user.withdrawnTotal = (user.withdrawnTotal || 0) + amount;
    await user.save();
    await logBalanceHistory(userId, "Withdrawn via " + gw.name + " (Auto UPI)", -amount);
    if (taxAmount > 0) {
      var ownerId = await getConfig("owner_id", MAIN_OWNER_ID);
      await User.findOneAndUpdate({ userId: ownerId }, { $inc: { balance: taxAmount } });
      await logBalanceHistory(ownerId, "Auto UPI Tax (" + gw.name + ")", taxAmount);
    }
    var msgId = ctx.callbackQuery.message.message_id;
    var chatId = ctx.chat.id;
    var animFrame = 0;
    var animInterval = setInterval(async function() {
      try { await ctx.api.editMessageText(chatId, msgId, "⏳ Processing " + buildProcessingDots(animFrame), { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
      animFrame++;
    }, 400);
    var result;
    try { result = await processAutoUpiPayout({ bot: bot, userId: userId, amount: amount, payoutAmount: payoutAmount, gateway: gw, upiId: upiId }); } finally { clearInterval(animInterval); }
    var maskedUPI = halfMaskUPI(upiId);
    if (result.status === "success") {
      var txnNumber = result.txnNumber || generateTxnNumber();
      var processTime = new Date();
      var withdrawalId = Math.floor(100000 + Math.random() * 900000).toString();
      await Withdrawal.create({ withdrawalId: withdrawalId, userId: userId, amount: amount, method: "AUTO_UPI_" + gw.name, details: upiId, status: "Approved", isGateway: true, gatewayName: gw.name, gatewayResponse: result.rawResponse || "", txnNumber: txnNumber, taxAmount: taxAmount, netAmount: payoutAmount, oldBalance: oldBalance, newBalance: user.balance, approvedBy: "Auto UPI", approvedAt: processTime });
      await LiveFund.findOneAndUpdate({ key: "main_fund" }, { $inc: { usedFund: amount } }, { upsert: true });
      var serverUrl = process.env.RENDER_EXTERNAL_URL || ("http://localhost:" + PORT);
      if (serverUrl.indexOf("http") !== 0) serverUrl = "https://" + serverUrl;
      var receiptUrl = serverUrl + "/receipt/" + withdrawalId;
      var successMsg = buildSuccessMessage(payoutAmount, maskedUPI, txnNumber, processTime, gw.name);
      await ctx.api.editMessageText(chatId, msgId, successMsg, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "✅ Check Status", url: receiptUrl, style: "success" }]] } }).catch(() => { });
      var restoreKb = await buildKeyboardFromLayout(userId);
      await ctx.reply(" ", { reply_markup: restoreKb }).then(function(m) { return ctx.api.deleteMessage(chatId, m.message_id).catch(() => { }); }).catch(() => { });
    } else {
      user.balance += amount;
      user.withdrawnTotal = Math.max(0, (user.withdrawnTotal || 0) - amount);
      await user.save();
      await logBalanceHistory(userId, "Auto UPI Failed (Refunded)", amount);
      await ctx.api.editMessageText(chatId, msgId, "❌ <b>Withdrawal Failed</b>\n\nAmount: " + RUPEE + amount.toFixed(2) + "\nGateway: " + gw.name + "\nReason: " + (result.message || "Gateway error") + "\n\n💵 Refunded: " + RUPEE + user.balance.toFixed(2), { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Menu", callback_data: "back_to_balance", style: "primary" }]] } }).catch(() => { });
    }
  } catch (e) { console.error("auto_upi_confirm error:", e.message); }
});

bot.callbackQuery(/^wd_bank_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  var userId = ctx.from.id;
  var gwId = ctx.callbackQuery.data.replace("wd_bank_", "");
  var bank = await AutoBank.findOne({ gatewayId: gwId, status: "active" });
  if (!bank) return ctx.answerCallbackQuery({ text: "Not available", show_alert: true }).catch(() => { });
  var user = await getUser(userId);
  if (!user.bankAccNo || user.bankAccNo === "Not Set" || !user.bankIfsc || user.bankIfsc === "Not Set") {
    return ctx.editMessageText("❌ <b>Bank Not Linked</b>\n\nPlease link Bank from Payout Method first.", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Payout Method", callback_data: "btn_payout_back", style: "primary" }, { text: "Back", callback_data: "back_to_withdraw", style: "primary" }]] } }).catch(() => { });
  }
  userState[userId] = "MANUAL_AMOUNT_auto_bank_" + gwId;
  var kb = new Keyboard().text("Cancel").resized().oneTime();
  await ctx.reply("Enter Withdraw Amount", { reply_markup: kb }).catch(() => { });
});

bot.callbackQuery("auto_bank_cancel", async (ctx) => {
  ctx.answerCallbackQuery({ text: "Cancelled" }).catch(() => { });
  delete userState[ctx.from.id];
  await sendBalancePage(ctx, true, false);
});

bot.callbackQuery(/^auto_bank_confirm_/, async (ctx) => {
  try {
    var data = ctx.callbackQuery.data.replace("auto_bank_confirm_", "");
    var parts = data.split("_");
    var amount = parseFloat(parts.pop());
    var gwId = parts.join("_");
    await ctx.answerCallbackQuery({ text: "Processing..." }).catch(() => { });
    var userId = ctx.from.id;
    delete userState[userId];
    var user = await getUser(userId);
    var gw = await AutoBank.findOne({ gatewayId: gwId, status: "active" });
    if (!gw) return ctx.editMessageText("❌ Gateway not available", { parse_mode: "HTML" }).catch(() => { });
    if (user.balance < amount) return ctx.editMessageText("❌ Insufficient balance", { parse_mode: "HTML" }).catch(() => { });
    if (!user.bankAccNo || user.bankAccNo === "Not Set" || !user.bankIfsc || user.bankIfsc === "Not Set") return ctx.editMessageText("❌ Bank not linked", { parse_mode: "HTML" }).catch(() => { });
    var taxAmount = calculateFixedTax(amount, gw.taxSlabs || []);
    var payoutAmount = amount - taxAmount;
    var oldBalance = user.balance;
    user.balance -= amount;
    user.withdrawnTotal = (user.withdrawnTotal || 0) + amount;
    await user.save();
    await logBalanceHistory(userId, "Withdrawn via " + gw.name + " (Auto Bank)", -amount);
    if (taxAmount > 0) {
      var ownerId = await getConfig("owner_id", MAIN_OWNER_ID);
      await User.findOneAndUpdate({ userId: ownerId }, { $inc: { balance: taxAmount } });
      await logBalanceHistory(ownerId, "Auto Bank Tax (" + gw.name + ")", taxAmount);
    }
    var msgId = ctx.callbackQuery.message.message_id;
    var chatId = ctx.chat.id;
    var animFrame = 0;
    var animInterval = setInterval(async function() {
      try { await ctx.api.editMessageText(chatId, msgId, "⏳ Processing " + buildProcessingDots(animFrame), { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
      animFrame++;
    }, 400);
    var result;
    try { result = await processAutoBankPayout({ bot: bot, userId: userId, amount: amount, payoutAmount: payoutAmount, gateway: gw, bankAccNo: user.bankAccNo, bankIfsc: user.bankIfsc }); } finally { clearInterval(animInterval); }
    var maskedBank = halfMaskBank(user.bankAccNo);
    if (result.status === "success") {
      var txnNumber = result.txnNumber || generateTxnNumber();
      var processTime = new Date();
      var withdrawalId = Math.floor(100000 + Math.random() * 900000).toString();
      await Withdrawal.create({ withdrawalId: withdrawalId, userId: userId, amount: amount, method: "AUTO_BANK_" + gw.name, details: user.bankAccNo + ", " + user.bankIfsc, status: "Approved", isGateway: true, gatewayName: gw.name, gatewayResponse: result.rawResponse || "", txnNumber: txnNumber, taxAmount: taxAmount, netAmount: payoutAmount, oldBalance: oldBalance, newBalance: user.balance, approvedBy: "Auto Bank", approvedAt: processTime });
      await LiveFund.findOneAndUpdate({ key: "main_fund" }, { $inc: { usedFund: amount } }, { upsert: true });
      var serverUrl = process.env.RENDER_EXTERNAL_URL || ("http://localhost:" + PORT);
      if (serverUrl.indexOf("http") !== 0) serverUrl = "https://" + serverUrl;
      var receiptUrl = serverUrl + "/receipt/" + withdrawalId;
      var successMsg = buildSuccessMessage(payoutAmount, maskedBank, txnNumber, processTime, gw.name);
      await ctx.api.editMessageText(chatId, msgId, successMsg, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "✅ Check Status", url: receiptUrl, style: "success" }]] } }).catch(() => { });
      var restoreKb = await buildKeyboardFromLayout(userId);
      await ctx.reply(" ", { reply_markup: restoreKb }).then(function(m) { return ctx.api.deleteMessage(chatId, m.message_id).catch(() => { }); }).catch(() => { });
    } else {
      user.balance += amount;
      user.withdrawnTotal = Math.max(0, (user.withdrawnTotal || 0) - amount);
      await user.save();
      await logBalanceHistory(userId, "Auto Bank Failed (Refunded)", amount);
      await ctx.api.editMessageText(chatId, msgId, "❌ <b>Withdrawal Failed</b>\n\nAmount: " + RUPEE + amount.toFixed(2) + "\nGateway: " + gw.name + "\nReason: " + (result.message || "Gateway error") + "\n\n💵 Refunded: " + RUPEE + user.balance.toFixed(2), { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Menu", callback_data: "back_to_balance", style: "primary" }]] } }).catch(() => { });
    }
  } catch (e) { console.error("auto_bank_confirm error:", e.message); }
});

bot.callbackQuery(/^wd_(upi|bank|amazon|redeem)$/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  var userId = ctx.from.id;
  var method = ctx.callbackQuery.data.replace("wd_", "");
  var user = await getUser(userId);
  var details = "";
  if (method === "upi") details = user.upiId;
  else if (method === "bank") details = (user.bankAccNo && user.bankAccNo !== "Not Set") ? (user.bankAccNo + ", " + user.bankIfsc) : "";
  else if (method === "amazon") details = user.amazonEmail;
  else if (method === "redeem") details = user.redeemCodeAddr;
  if (!details || details === "Not Set" || details.indexOf("Not Set") >= 0) {
    var stateKey = "";
    if (method === "upi") stateKey = "WD_ADD_UPI";
    else if (method === "bank") stateKey = "WD_ADD_BANK_ACCNO";
    else if (method === "amazon") stateKey = "WD_ADD_AMAZON";
    else if (method === "redeem") stateKey = "WD_ADD_REDEEM";
    userState[userId] = stateKey;
    var kb = new Keyboard().text("Cancel").resized().oneTime();
    return ctx.reply(method.toUpperCase() + " not linked!\n\nSend your " + method.toUpperCase() + " details:", { reply_markup: kb }).catch(() => { });
  }
  userState[userId] = "MANUAL_AMOUNT_" + method;
  var kb2 = new Keyboard().text("Cancel").resized().oneTime();
  await ctx.reply("Enter Withdraw Amount", { reply_markup: kb2 }).catch(() => { });
});

bot.callbackQuery(/^man_conf_yes_/, async (ctx) => {
  try {
    var data = ctx.callbackQuery.data.replace("man_conf_yes_", "");
    var parts = data.split("_");
    var amount = parseFloat(parts.pop());
    var method = parts.join("_").toLowerCase();
    await ctx.answerCallbackQuery({ text: "Processing..." }).catch(() => { });
    var userId = ctx.from.id;
    delete userState[userId];
    var user = await getUser(userId);
    var details = "";
    if (method === "upi") details = user.upiId;
    else if (method === "bank") details = (user.bankAccNo && user.bankAccNo !== "Not Set") ? (user.bankAccNo + ", " + user.bankIfsc) : "";
    else if (method === "amazon") details = user.amazonEmail;
    else if (method === "redeem") details = user.redeemCodeAddr;
    if (!details || details === "Not Set" || details.indexOf("Not Set") >= 0) return ctx.editMessageText("❌ Method not linked!", { parse_mode: "HTML" }).catch(() => { });
    var ws = await WithdrawSettings.findOne({ method: method }).lean();
    var minW = ws ? ws.minAmount : 0;
    var maxW = ws ? ws.maxAmount : 0;
    if (minW > 0 && amount < minW) return ctx.editMessageText("❌ Minimum: " + RUPEE + minW, { parse_mode: "HTML" }).catch(() => { });
    if (maxW > 0 && amount > maxW) return ctx.editMessageText("❌ Maximum: " + RUPEE + maxW, { parse_mode: "HTML" }).catch(() => { });
    if (user.balance < amount) return ctx.editMessageText("❌ Insufficient balance!", { parse_mode: "HTML" }).catch(() => { });
    var taxAmount = calculateFixedTax(amount, ws ? ws.taxSlabs : []);
    var netAmount = amount - taxAmount;
    var oldBalance = user.balance;
    user.balance -= amount;
    user.withdrawnTotal = (user.withdrawnTotal || 0) + amount;
    await user.save();
    await logBalanceHistory(userId, "Withdrawn via " + method.toUpperCase() + " (Bot)", -amount);
    if (taxAmount > 0) {
      var ownerId = await getConfig("owner_id", MAIN_OWNER_ID);
      await User.findOneAndUpdate({ userId: ownerId }, { $inc: { balance: taxAmount } });
      await logBalanceHistory(ownerId, "Withdrawal Tax (" + method + ")", taxAmount);
    }
    var approvedCount = await Withdrawal.countDocuments({ userId: userId, status: "Approved" });
    var userWithdrawalCount = approvedCount + 1;
    var withdrawalId = Math.floor(100000 + Math.random() * 900000).toString();
    var methodLabel = method.toUpperCase();
    var txnNumber = generateTxnNumber();
    var paymentRef = generatePaymentRef();
    await Withdrawal.create({ withdrawalId: withdrawalId, userId: userId, userWithdrawalCount: userWithdrawalCount, amount: amount, method: methodLabel, details: details, status: "Pending", isGateway: false, txnNumber: txnNumber, paymentRef: paymentRef, taxAmount: taxAmount, netAmount: netAmount, oldBalance: oldBalance, newBalance: user.balance });
    await ctx.editMessageText(buildManualPendingMessage(amount, methodLabel, halfMaskDetails(methodLabel, details), userWithdrawalCount, taxAmount, netAmount, user.balance), { parse_mode: "HTML" }).catch(() => { });
    var payoutChannel = await getMethodPayoutChannel(method, ws);
    if (payoutChannel && payoutChannel !== "Not Set") {
      var adminKb = { inline_keyboard: [[{ text: "✅ Approve", callback_data: "wd_app_" + withdrawalId, style: "success" }, { text: "🚫 Reject", callback_data: "wd_rej_" + withdrawalId, style: "danger" }]] };
      try {
        await bot.api.sendMessage(payoutChannel, buildPayoutChannelMessage(methodLabel, userWithdrawalCount, userId, amount, netAmount, halfMaskDetails(methodLabel, details), paymentRef, "Pending"), { parse_mode: "HTML", reply_markup: adminKb, disable_web_page_preview: true }).catch(() => { });
      } catch (e) { console.error("Payout channel error:", e.message); }
    }
    var restoreKb = await buildKeyboardFromLayout(userId);
    await ctx.reply(" ", { reply_markup: restoreKb }).then(function(m) { return ctx.api.deleteMessage(ctx.chat.id, m.message_id).catch(() => { }); }).catch(() => { });
  } catch (e) { console.error("man_conf_yes error:", e.message); }
});

bot.callbackQuery("man_conf_no", async (ctx) => {
  ctx.answerCallbackQuery({ text: "Cancelled" }).catch(() => { });
  delete userState[ctx.from.id];
  await sendBalancePage(ctx, true, false);
});

bot.callbackQuery("qp_cancel", async (ctx) => {
  var userId = ctx.from.id;
  delete userState[userId];
  if (global.quickPayCache) delete global.quickPayCache[userId];
  await ctx.answerCallbackQuery({ text: "Cancelled!" }).catch(() => { });
  await ctx.editMessageText("Cancelled", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "back_to_balance", style: "primary" }]] } }).catch(() => { });
  var restoreKb = await buildKeyboardFromLayout(userId);
  await ctx.reply(" ", { reply_markup: restoreKb }).then(function(m) { return ctx.api.deleteMessage(ctx.chat.id, m.message_id).catch(() => { }); }).catch(() => { });
});

bot.callbackQuery("qp_retry", async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => { });
  var userId = ctx.from.id;
  userState[userId] = "QP_WAIT_INPUT";
  var title = "💡" + toSmallCaps("Quick Pay To a Simple User Payment Send");
  var openingUsername = ctx.from.username ? "@" + ctx.from.username : "No Username";
  var adminId = await getConfig("owner_id", MAIN_OWNER_ID);
  var bodyText = toSmallCaps("You Can Also Use The Format Below:") + "\n\n<code>" + userId + " 5</code>     <code>" + openingUsername + " 5</code>\n<code>" + adminId + " 10</code>     <code>@username 10</code>";
  await ctx.editMessageText(title + "\n\n<blockquote>" + bodyText + "</blockquote>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "qp_cancel", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("qp_confirm_multi", async (ctx) => {
  try {
    var userId = ctx.from.id;
    var cacheObj = global.quickPayCache && global.quickPayCache[userId];
    if (!cacheObj || !cacheObj.payments || cacheObj.payments.length === 0) return ctx.answerCallbackQuery({ text: "Expired!", show_alert: true }).catch(() => { });
    var payments = cacheObj.payments;
    var totalAmount = payments.reduce(function(sum, p) { return sum + p.amount; }, 0);
    delete userState[userId];
    delete global.quickPayCache[userId];
    var sender = await getUser(userId);
    var isPrivileged = (await isAdmin(userId)) || (await isOwner(userId)) || (await isWhitelisted(userId));
    var unlimited = await getConfig("quick_pay_unlimited", true);
    var negativeAllowed = await getConfig("quick_pay_negative_balance", false);
    var skipBalance = isPrivileged && unlimited;
    if (!skipBalance && !negativeAllowed && sender.balance < totalAmount) return ctx.answerCallbackQuery({ text: "Insufficient!", show_alert: true }).catch(() => { });
    await ctx.answerCallbackQuery({ text: "Processing..." }).catch(() => { });
    var taxPercent = await getConfig("quick_pay_tax_percent", 0);
    var taxAmount = 0;
    if (taxPercent > 0) taxAmount = (totalAmount * taxPercent) / 100;
    var senderBefore = sender.balance;
    if (skipBalance) await logBalanceHistory(sender.userId, "Admin Quick Pay (" + payments.length + " payments) - Unlimited", 0);
    else { sender.balance -= totalAmount; await sender.save(); await logBalanceHistory(sender.userId, "Quick Pay (" + payments.length + " payments)", -totalAmount); }
    if (taxAmount > 0) {
      var ownerId = await getConfig("owner_id", MAIN_OWNER_ID);
      await User.findOneAndUpdate({ userId: ownerId }, { $inc: { balance: taxAmount } });
      await logBalanceHistory(ownerId, "Quick Pay Tax from " + userId, taxAmount);
    }
    var resultList = [];
    for (var i = 0; i < payments.length; i++) {
      var p = payments[i];
      var receiver = await User.findOne({ userId: p.receiver.userId });
      if (!receiver) continue;
      var addAmount = taxPercent > 0 ? (p.amount - (p.amount * taxPercent / 100)) : p.amount;
      var before = receiver.balance;
      receiver.balance += addAmount;
      await receiver.save();
      await logBalanceHistory(receiver.userId, "Quick Pay from " + (isPrivileged ? "Admin" : sender.userId), addAmount);
      resultList.push({ userId: receiver.userId, firstName: receiver.firstName || "User", amount: addAmount, before: before, after: receiver.balance });
      try {
        var senderName = sender.firstName || "User";
        var safeName = escapeHtml(senderName);
        var senderLink = '<a href="tg://user?id=' + sender.userId + '">' + safeName + "</a>";
        await ctx.api.sendMessage(receiver.userId, "💸 " + toSmallCaps("You Received") + " " + RUPEE + addAmount.toFixed(2) + " " + toSmallCaps("From") + " " + senderLink, { parse_mode: "HTML", link_preview_options: { is_disabled: true } }).catch(() => { });
      } catch (e) { }
    }
    var bodyText = "";
    resultList.forEach(function(r, i) { bodyText += (i + 1) + ". " + r.firstName + " (" + r.userId + ")\nAmount: " + RUPEE + r.amount.toFixed(2) + "\nBalance: " + RUPEE + r.after.toFixed(2) + "\n\n"; });
    bodyText += "Total Users: " + resultList.length + "\nTotal Sent: " + RUPEE + totalAmount.toFixed(2) + "\n";
    if (skipBalance) bodyText += "Mode: 👑 Admin/Owner (Unlimited)";
    else bodyText += "Your Balance: " + RUPEE + senderBefore.toFixed(2) + " → " + RUPEE + sender.balance.toFixed(2);
    await ctx.editMessageText("<b>" + toSmallCaps("Payment Successful") + "</b>\n\n<blockquote>" + bodyText + "</blockquote>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "back_to_balance", style: "primary" }]] } }).catch(() => { });
    var restoreKb = await buildKeyboardFromLayout(userId);
    await ctx.reply(" ", { reply_markup: restoreKb }).then(function(m) { return ctx.api.deleteMessage(ctx.chat.id, m.message_id).catch(() => { }); }).catch(() => { });
  } catch (e) { console.error("qp_confirm_multi error:", e.message); }
});

bot.callbackQuery("adm_quick_pay", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderQuickPaySettings(ctx);
});

async function renderQuickPaySettings(ctx) {
  var enabled = await getConfig("quick_pay_enabled", true);
  var unlimited = await getConfig("quick_pay_unlimited", true);
  var negative = await getConfig("quick_pay_negative_balance", false);
  var taxPercent = await getConfig("quick_pay_tax_percent", 0);
  var whitelist = await getConfig("quick_pay_whitelist", []);
  var wlCount = Array.isArray(whitelist) ? whitelist.length : 0;
  var text = "⚡ <b>Quick Pay Settings</b>\n\n📊 Global: " + (enabled ? "🟢 ON" : "🔴 OFF") + "\n♾️ Unlimited: " + (unlimited ? "🟢 ON" : "🔴 OFF") + "\n📉 Negative Balance: " + (negative ? "🟢 ON" : "🔴 OFF") + "\n📊 Tax: " + taxPercent + "%\n👥 Whitelist: " + wlCount + " users\n\n👇 Choose:";
  var kb = new InlineKeyboard()
    .row({ text: "📊 Global: " + (enabled ? "ON" : "OFF"), callback_data: "qp_toggle_global", style: "primary" })
    .row({ text: "♾️ Unlimited: " + (unlimited ? "ON" : "OFF"), callback_data: "qp_toggle_unlimited", style: "primary" })
    .row({ text: "📉 Negative: " + (negative ? "ON" : "OFF"), callback_data: "qp_toggle_negative", style: "primary" })
    .row({ text: "👥 Whitelist Users", callback_data: "qp_whitelist", style: "primary" })
    .row({ text: "📊 Set Tax %", callback_data: "qp_set_tax", style: "primary" })
    .row({ text: "Back", callback_data: "admin", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("qp_toggle_global", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var cur = await getConfig("quick_pay_enabled", true);
  await setConfig("quick_pay_enabled", !cur);
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Quick Pay Global Toggle", !cur ? "ON" : "OFF", 0, null);
  await ctx.answerCallbackQuery({ text: !cur ? "🟢 ON" : "🔴 OFF" }).catch(() => { });
});

bot.callbackQuery("qp_toggle_unlimited", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var cur = await getConfig("quick_pay_unlimited", true);
  await setConfig("quick_pay_unlimited", !cur);
  await ctx.answerCallbackQuery({ text: !cur ? "🟢 ON" : "🔴 OFF" }).catch(() => { });
});

bot.callbackQuery("qp_toggle_negative", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var cur = await getConfig("quick_pay_negative_balance", false);
  await setConfig("quick_pay_negative_balance", !cur);
  await ctx.answerCallbackQuery({ text: !cur ? "🟢 ON" : "🔴 OFF" }).catch(() => { });
});

bot.callbackQuery("qp_whitelist", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderQuickPayWhitelist(ctx);
});

async function renderQuickPayWhitelist(ctx) {
  var whitelist = await getConfig("quick_pay_whitelist", []);
  if (!Array.isArray(whitelist)) whitelist = [];
  var bodyText = "Total: " + whitelist.length + "\n\n";
  if (whitelist.length === 0) bodyText += "No whitelisted users.";
  else {
    for (var i = 0; i < whitelist.length; i++) {
      var uid = whitelist[i];
      var u = await User.findOne({ userId: uid }).lean();
      bodyText += (i + 1) + ". " + (u ? (u.firstName || "User") : "User") + " (" + uid + ")\n";
    }
  }
  var kb = new InlineKeyboard()
    .row({ text: "➕ Add User ID", callback_data: "qp_whitelist_add", style: "success" })
    .row({ text: "➖ Remove User ID", callback_data: "qp_whitelist_remove", style: "danger" })
    .row({ text: "Back", callback_data: "adm_quick_pay", style: "primary" });
  await ctx.editMessageText("👥 <b>Whitelist Users</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("qp_whitelist_add", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "QP_WHITELIST_ADD";
  await ctx.editMessageText("➕ <b>Add to Whitelist</b>\n\n📝 Send User ID:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "qp_whitelist", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("qp_whitelist_remove", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "QP_WHITELIST_REMOVE";
  await ctx.editMessageText("➖ <b>Remove from Whitelist</b>\n\n📝 Send User ID:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "qp_whitelist", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("qp_set_tax", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "QP_SET_TAX";
  var cur = await getConfig("quick_pay_tax_percent", 0);
  await ctx.editMessageText("📊 <b>Set Quick Pay Tax</b>\n\nCurrent: " + cur + "%\n\n📝 Send new tax % (0-50):", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_quick_pay", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^wd_app_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var wdId = ctx.callbackQuery.data.replace("wd_app_", "");
  var wd = await Withdrawal.findOne({ withdrawalId: wdId });
  if (!wd || wd.status !== "Pending") return ctx.answerCallbackQuery({ text: "Already processed", show_alert: true }).catch(() => { });
  var processTime = new Date();
  var adminTag = ctx.from.username ? "@" + ctx.from.username : (ctx.from.first_name || "Admin");
  wd.status = "Approved";
  if (!wd.txnNumber) wd.txnNumber = generateTxnNumber();
  wd.approvedBy = adminTag;
  wd.approvedAt = processTime;
  await wd.save();
  await LiveFund.findOneAndUpdate({ key: "main_fund" }, { $inc: { usedFund: wd.amount } }, { upsert: true });
  var serverUrl = process.env.RENDER_EXTERNAL_URL || ("http://localhost:" + PORT);
  if (serverUrl.indexOf("http") !== 0) serverUrl = "https://" + serverUrl;
  var receiptUrl = serverUrl + "/receipt/" + wd.withdrawalId;
  await ctx.answerCallbackQuery({ text: "✅ Approved!" }).catch(() => { });
  var userNotified = false;
  try {
    await bot.api.sendMessage(wd.userId, buildSuccessMessage(wd.netAmount || wd.amount, halfMaskDetails(wd.method, wd.details), wd.txnNumber, processTime, wd.method), { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "✅ Check Status", url: receiptUrl, style: "success" }]] } });
    userNotified = true;
  } catch (e) { console.error("User notify fail:", e.message); }
  var maskedDetails = halfMaskDetails(wd.method, wd.details);
  var methodDisplay = wd.method.toUpperCase();
  var taxAmount = wd.taxAmount || 0;
  var netAmount = wd.netAmount || (wd.amount - taxAmount);
  try {
    await ctx.editMessageText(buildPayoutChannelMessage(methodDisplay, wd.userWithdrawalCount, wd.userId, wd.amount, netAmount, maskedDetails, wd.paymentRef || "-", "approved by " + adminTag + " at " + formatDateTime(processTime)), { parse_mode: "HTML" }).catch(() => { });
  } catch (e) { }
});

bot.callbackQuery(/^wd_rej_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var wdId = ctx.callbackQuery.data.replace("wd_rej_", "");
  var wd = await Withdrawal.findOne({ withdrawalId: wdId });
  if (!wd || wd.status !== "Pending") return ctx.answerCallbackQuery({ text: "Already processed", show_alert: true }).catch(() => { });
  var processTime = new Date();
  var adminTag = ctx.from.username ? "@" + ctx.from.username : (ctx.from.first_name || "Admin");
  wd.status = "Rejected";
  wd.approvedBy = adminTag;
  wd.approvedAt = processTime;
  await wd.save();
  var user = await getUser(wd.userId);
  user.balance += wd.amount;
  user.withdrawnTotal = Math.max(0, (user.withdrawnTotal || 0) - wd.amount);
  await user.save();
  await logBalanceHistory(wd.userId, "Withdrawal Refunded", wd.amount);
  await ctx.answerCallbackQuery({ text: "❌ Rejected!" }).catch(() => { });
  try { await bot.api.sendMessage(wd.userId, "❌ <b>Withdrawal Rejected</b>\n\n💰 " + RUPEE + wd.amount.toFixed(2) + "\n💵 Refunded: " + RUPEE + user.balance.toFixed(2), { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
  var maskedDetails = halfMaskDetails(wd.method, wd.details);
  var methodDisplay = wd.method.toUpperCase();
  var taxAmount = wd.taxAmount || 0;
  var netAmount = wd.netAmount || (wd.amount - taxAmount);
  try {
    await ctx.editMessageText(buildPayoutChannelMessage(methodDisplay, wd.userWithdrawalCount, wd.userId, wd.amount, netAmount, maskedDetails, wd.paymentRef || "-", "rejected by " + adminTag + " at " + formatDateTime(processTime)), { parse_mode: "HTML" }).catch(() => { });
  } catch (e) { }
});

bot.callbackQuery("adm_recent_actions", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var logs = await AdminLog.find({}).sort({ createdAt: -1 }).limit(15).lean();
  var bodyText = "";
  if (logs.length === 0) bodyText = "No actions yet.";
  else logs.forEach(function(log, i) { bodyText += (i + 1) + ". " + log.adminName + "\n   " + log.action + (log.details ? ": " + log.details : "") + "\n   " + formatDateTime(log.createdAt) + "\n\n"; });
  var kb = new InlineKeyboard().row({ text: "Refresh", callback_data: "adm_recent_actions", style: "primary" }).row({ text: "Back", callback_data: "admin", style: "primary" });
  await ctx.editMessageText("<b>Recent Admin Actions</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_user_notif", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var enabled = await getConfig("new_user_notif", true);
  var kb = new InlineKeyboard().row({ text: enabled ? "Turn OFF" : "Turn ON", callback_data: "adm_toggle_notif", style: enabled ? "danger" : "success" }).row({ text: "Back", callback_data: "admin", style: "primary" });
  await ctx.editMessageText("<b>New User Notification</b>\n\n📊 Status: " + (enabled ? "🟢 ON" : "🔴 OFF"), { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("adm_toggle_notif", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var cur = await getConfig("new_user_notif", true);
  await setConfig("new_user_notif", !cur);
  await ctx.answerCallbackQuery({ text: !cur ? "ON" : "OFF" }).catch(() => { });
});

bot.command("admin", async (ctx) => {
  var userId = ctx.from.id;
  var disabled = await isAdminDisabled(userId);
  if (disabled) {
    var ownerId = await getConfig("owner_id", MAIN_OWNER_ID);
    var ownerUser = await User.findOne({ userId: ownerId }).lean();
    var ownerName = ownerUser ? (ownerUser.firstName || "Owner") : "Owner";
    return ctx.reply("❌ <b>ADMIN ACCESS DISABLED</b>\n\nYour admin permissions have been disabled by the Owner.\n\n📞 Contact Owner: " + ownerName + "\n🆔 Owner ID: " + ownerId, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "back_to_balance", style: "primary" }]] } }).catch(() => { });
  }
  if (!(await isAdmin(userId))) return ctx.reply("❌ Not an admin!", { parse_mode: "HTML" }).catch(() => { });
  await sendAdminPanel(ctx, false);
});

bot.on("message:text", async (ctx, next) => {
  try {
    var text = ctx.message.text.trim();
    var userId = ctx.from.id;
    var state = userState[userId];
    if (state && await isAdmin(userId)) {
      try {
        var handled = await handleAdminTextInput(ctx, text, userId, state);
        if (handled) return;
      } catch (err) { console.error("Admin handler error:", err.message); }
    }
    if (state) {
      if (text === toSmallCaps("Cancel") || text === "❌ Cancel" || text.toLowerCase() === "cancel") {
        delete userState[userId];
        if (global.quickPayCache) delete global.quickPayCache[userId];
        await ctx.reply("Cancelled", { reply_markup: await buildKeyboardFromLayout(userId), parse_mode: "HTML" }).catch(() => { });
        return;
      }
      if (state === "AWAITING_WITHDRAW_METHOD") {
        return ctx.reply("⚠️ Please select a withdraw method first", { parse_mode: "HTML", reply_markup: { inline_keyboard: await buildWithdrawMenu() } }).catch(() => { });
      }
      if (state === "SET_WALLET_NUMBER") {
        delete userState[userId];
        var number = text.trim();
        if (!validateWallet(number)) return ctx.reply("⛔️ <b>Invalid Wallet Number</b>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "btn_payout_back", style: "primary" }]] } }).catch(() => { });
        var user = await getUser(userId);
        user.walletNumber = number;
        await user.save();
        await ctx.reply("✅ <b>Wallet Added Successfully</b>\n\nWallet : <code>" + number + "</code>", { parse_mode: "HTML", reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        return;
      }
      if (state === "SET_UPI_ACC") {
        var upi = text.trim();
        if (!validateUPI(upi)) return ctx.reply("⛔️ <b>Invalid UPI/VPA Address</b>", { parse_mode: "HTML" }).catch(() => { });
        delete userState[userId];
        await User.findOneAndUpdate({ userId: userId }, { upiId: upi });
        await ctx.reply("✅ <b>UPI Added Successfully</b>\n\nUPI ID : <code>" + upi + "</code>", { parse_mode: "HTML", reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        return;
      }
      if (state === "SET_BANK_ACCNO") {
        var accNo = text.trim();
        if (!validateBankAcc(accNo)) return ctx.reply("⛔️ <b>Invalid Account Number</b>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "btn_payout_back", style: "primary" }]] } }).catch(() => { });
        userState[userId] = "SET_BANK_IFSC_" + accNo;
        return ctx.reply("📝 <b>Send Your IFSC Code</b>\n\nFormat: <code>SBIN0001234</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "btn_payout_back", style: "primary" }]] } }).catch(() => { });
      }
      if (state.indexOf("SET_BANK_IFSC_") === 0) {
        var accNo2 = state.replace("SET_BANK_IFSC_", "");
        var ifsc = text.trim().toUpperCase();
        if (!validateIFSC(ifsc)) return ctx.reply("⛔️ <b>Invalid IFSC Code</b>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "btn_payout_back", style: "primary" }]] } }).catch(() => { });
        delete userState[userId];
        await User.findOneAndUpdate({ userId: userId }, { bankAccNo: accNo2, bankIfsc: ifsc });
        await ctx.reply("✅ <b>Bank Added Successfully</b>\n\nBank : <code>" + accNo2 + " (" + ifsc + ")</code>", { parse_mode: "HTML", reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        return;
      }
      if (state.indexOf("GW_NUMBER_") === 0) {
        var gwName = state.replace("GW_NUMBER_", "");
        var num = text.trim();
        if (!validateWallet(num)) return ctx.reply("⛔️ <b>Invalid Wallet Number</b>", { parse_mode: "HTML" }).catch(() => { });
        var gateway = await Gateway.findOne({ name: gwName, isActive: true });
        if (!gateway) { delete userState[userId]; return ctx.reply("❌ Gateway not found.").catch(() => { }); }
        var u = await getUser(userId);
        u.walletNumber = num;
        await u.save();
        userState[userId] = "GW_AMOUNT_" + gwName;
        var kb = new Keyboard().text("Cancel").resized().oneTime();
        return ctx.reply("Enter Withdraw Amount", { reply_markup: kb }).catch(() => { });
      }
      if (state.indexOf("GW_AMOUNT_") === 0) {
        var gwName2 = state.replace("GW_AMOUNT_", "");
        delete userState[userId];
        var amount = parseFloat(text);
        if (isNaN(amount) || amount <= 0) return ctx.reply("❌ Invalid amount!", { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        var user2 = await getUser(userId);
        var gateway2 = await Gateway.findOne({ name: gwName2, isActive: true });
        if (!gateway2) return ctx.reply("❌ Gateway not found.", { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        var minW = gateway2.minAmount || 0;
        var maxW = gateway2.maxAmount || 0;
        if (minW > 0 && amount < minW) return ctx.reply("❌ Minimum: " + RUPEE + minW, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (maxW > 0 && amount > maxW) return ctx.reply("❌ Maximum: " + RUPEE + maxW, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (user2.balance < amount) return ctx.reply("❌ Insufficient balance! Your Balance: " + RUPEE + user2.balance.toFixed(2), { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        var wallet = user2.walletNumber || "";
        if (!wallet) return ctx.reply("❌ Number not saved!", { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        var taxAmount = calculateFixedTax(amount, gateway2.taxSlabs || []);
        var payoutAmount = amount - taxAmount;
        userState[userId] = "GW_CONFIRM_" + gwName2 + "_" + amount;
        return ctx.reply(buildWithdrawalConfirmMessage(amount, payoutAmount, taxAmount, wallet), { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Confirm ✅", callback_data: "gw_conf_yes_" + gwName2 + "_" + amount, style: "success" }, { text: "Cancel ❌", callback_data: "gw_conf_no", style: "danger" }]] } }).catch(() => { });
      }
      if (state.indexOf("MANUAL_AMOUNT_auto_upi_") === 0) {
        var gwId = state.replace("MANUAL_AMOUNT_auto_upi_", "");
        delete userState[userId];
        var amt = parseFloat(text);
        if (isNaN(amt) || amt <= 0) return ctx.reply("❌ Invalid amount!", { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        var gw = await AutoUpi.findOne({ gatewayId: gwId, status: "active" });
        if (!gw) return ctx.reply("❌ Gateway not available", { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        var user3 = await getUser(userId);
        if (!user3.upiId || user3.upiId === "Not Set") return ctx.reply("❌ UPI not linked!", { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (gw.minAmount > 0 && amt < gw.minAmount) return ctx.reply("❌ Min: " + RUPEE + gw.minAmount, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (gw.maxAmount > 0 && amt > gw.maxAmount) return ctx.reply("❌ Max: " + RUPEE + gw.maxAmount, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (user3.balance < amt) return ctx.reply("❌ Insufficient balance!", { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        var taxAmount2 = calculateFixedTax(amt, gw.taxSlabs || []);
        var payoutAmount2 = amt - taxAmount2;
        return ctx.reply(buildWithdrawalConfirmMessage(amt, payoutAmount2, taxAmount2, user3.upiId), { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Confirm ✅", callback_data: "auto_upi_confirm_" + gwId + "_" + amt, style: "success" }, { text: "Cancel ❌", callback_data: "auto_upi_cancel", style: "danger" }]] } }).catch(() => { });
      }
      if (state.indexOf("MANUAL_AMOUNT_auto_bank_") === 0) {
        var gwId2 = state.replace("MANUAL_AMOUNT_auto_bank_", "");
        delete userState[userId];
        var amt2 = parseFloat(text);
        if (isNaN(amt2) || amt2 <= 0) return ctx.reply("❌ Invalid amount!", { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        var bank = await AutoBank.findOne({ gatewayId: gwId2, status: "active" });
        if (!bank) return ctx.reply("❌ Gateway not available", { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        var user4 = await getUser(userId);
        if (!user4.bankAccNo || user4.bankAccNo === "Not Set" || !user4.bankIfsc || user4.bankIfsc === "Not Set") return ctx.reply("❌ Bank not linked!", { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (bank.minAmount > 0 && amt2 < bank.minAmount) return ctx.reply("❌ Min: " + RUPEE + bank.minAmount, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (bank.maxAmount > 0 && amt2 > bank.maxAmount) return ctx.reply("❌ Max: " + RUPEE + bank.maxAmount, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (user4.balance < amt2) return ctx.reply("❌ Insufficient balance!", { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        var taxAmount3 = calculateFixedTax(amt2, bank.taxSlabs || []);
        var payoutAmount3 = amt2 - taxAmount3;
        return ctx.reply(buildWithdrawalConfirmMessage(amt2, payoutAmount3, taxAmount3, halfMaskBank(user4.bankAccNo)), { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Confirm ✅", callback_data: "auto_bank_confirm_" + gwId2 + "_" + amt2, style: "success" }, { text: "Cancel ❌", callback_data: "auto_bank_cancel", style: "danger" }]] } }).catch(() => { });
      }
      if (state.indexOf("MANUAL_AMOUNT_") === 0) {
        var method = state.replace("MANUAL_AMOUNT_", "");
        delete userState[userId];
        var amt3 = parseFloat(text);
        if (isNaN(amt3) || amt3 <= 0) return ctx.reply("❌ Invalid amount!", { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        var user5 = await getUser(userId);
        var details = "";
        if (method === "upi") details = user5.upiId;
        else if (method === "bank") details = (user5.bankAccNo && user5.bankAccNo !== "Not Set") ? (user5.bankAccNo + ", " + user5.bankIfsc) : "";
        else if (method === "amazon") details = user5.amazonEmail;
        else if (method === "redeem") details = user5.redeemCodeAddr;
        if (!details || details === "Not Set" || details.indexOf("Not Set") >= 0) return ctx.reply("❌ " + method.toUpperCase() + " not linked! Please add it first.", { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        var ws = await WithdrawSettings.findOne({ method: method }).lean();
        var minW2 = ws ? ws.minAmount : 0;
        var maxW2 = ws ? ws.maxAmount : 0;
        if (minW2 > 0 && amt3 < minW2) return ctx.reply("❌ Minimum: " + RUPEE + minW2, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (maxW2 > 0 && amt3 > maxW2) return ctx.reply("❌ Maximum: " + RUPEE + maxW2, { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (user5.balance < amt3) return ctx.reply("❌ Insufficient balance! Your Balance: " + RUPEE + user5.balance.toFixed(2), { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        var taxAmount4 = calculateFixedTax(amt3, ws ? ws.taxSlabs : []);
        var netAmount = amt3 - taxAmount4;
        userState[userId] = "MANUAL_CONFIRM_" + method + "_" + amt3;
        return ctx.reply(buildWithdrawalConfirmMessage(amt3, netAmount, taxAmount4, details), { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Confirm ✅", callback_data: "man_conf_yes_" + method + "_" + amt3, style: "success" }, { text: "Cancel ❌", callback_data: "man_conf_no", style: "danger" }]] } }).catch(() => { });
      }
      if (state === "WD_ADD_UPI") {
        var upi2 = text.trim();
        if (!validateUPI(upi2)) return ctx.reply("⛔️ <b>Invalid UPI/VPA Address</b>", { parse_mode: "HTML" }).catch(() => { });
        delete userState[userId];
        var user6 = await getUser(userId);
        user6.upiId = upi2;
        await user6.save();
        return ctx.reply("✅ UPI Saved!\n\n📌 <code>" + upi2 + "</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "back_to_withdraw", style: "primary" }]] } }).catch(() => { });
      }
      if (state === "WD_ADD_BANK_ACCNO") {
        var accNo3 = text.trim();
        if (!validateBankAcc(accNo3)) return ctx.reply("⛔️ <b>Invalid Account Number</b>", { parse_mode: "HTML" }).catch(() => { });
        userState[userId] = "WD_ADD_BANK_IFSC_" + accNo3;
        return ctx.reply("✅ Account: <code>" + accNo3 + "</code>\n\n📝 Send IFSC Code:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "back_to_withdraw", style: "danger" }]] } }).catch(() => { });
      }
      if (state.indexOf("WD_ADD_BANK_IFSC_") === 0) {
        var accNo4 = state.replace("WD_ADD_BANK_IFSC_", "");
        var ifsc2 = text.trim().toUpperCase();
        if (!validateIFSC(ifsc2)) return ctx.reply("⛔️ <b>Invalid IFSC Code</b>", { parse_mode: "HTML" }).catch(() => { });
        delete userState[userId];
        var user7 = await getUser(userId);
        user7.bankAccNo = accNo4;
        user7.bankIfsc = ifsc2;
        await user7.save();
        return ctx.reply("✅ Bank Saved!\n\n🏦 <code>" + accNo4 + "</code>\n🔢 <code>" + ifsc2 + "</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "back_to_withdraw", style: "primary" }]] } }).catch(() => { });
      }
      if (state === "WD_ADD_AMAZON") {
        var email = text.trim();
        if (email.indexOf("@") < 0) return ctx.reply("⛔️ <b>Invalid Email</b>", { parse_mode: "HTML" }).catch(() => { });
        delete userState[userId];
        var user8 = await getUser(userId);
        user8.amazonEmail = email;
        await user8.save();
        return ctx.reply("✅ Amazon Saved!\n\n📧 <code>" + email + "</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "back_to_withdraw", style: "primary" }]] } }).catch(() => { });
      }
      if (state === "WD_ADD_REDEEM") {
        var addr = text.trim();
        delete userState[userId];
        var user9 = await getUser(userId);
        user9.redeemCodeAddr = addr;
        await user9.save();
        return ctx.reply("✅ Redeem Saved!\n\n🎁 <code>" + addr + "</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "back_to_withdraw", style: "primary" }]] } }).catch(() => { });
      }
      if (state === "QP_WAIT_INPUT") {
        delete userState[userId];
        var lines = text.trim().split("\n").map(function(l) { return l.trim(); }).filter(function(l) { return l !== ""; });
        if (lines.length === 0) return ctx.reply("No data provided!", { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        if (lines.length > 20) return ctx.reply("Maximum 20 payments at once!", { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        var parsed = [];
        var errors = [];
        for (var li = 0; li < lines.length; li++) {
          var parts2 = lines[li].split(/\s+/).filter(function(p) { return p !== ""; });
          if (parts2.length < 2) { errors.push(lines[li] + " (invalid format)"); continue; }
          var userInput = parts2[0].trim();
          var amtVal = parseFloat(parts2[parts2.length - 1]);
          if (isNaN(amtVal) || amtVal <= 0) { errors.push(lines[li] + " (invalid amount)"); continue; }
          var receiver = null;
          if (/^\d+$/.test(userInput)) receiver = await User.findOne({ userId: parseInt(userInput, 10) }).lean();
          else if (userInput.indexOf("@") === 0) { var cleanU = userInput.replace(/^@/, "").toLowerCase(); receiver = await User.findOne({ username: { $regex: new RegExp("^" + cleanU + "$", "i") } }).lean(); }
          else if (/^[a-zA-Z0-9_]{5,32}$/.test(userInput)) { var cleanU2 = userInput.toLowerCase(); receiver = await User.findOne({ username: { $regex: new RegExp("^" + cleanU2 + "$", "i") } }).lean(); }
          if (!receiver) { errors.push(userInput + " (user not found)"); continue; }
          if (receiver.userId === userId) { errors.push(userInput + " (cannot pay yourself)"); continue; }
          parsed.push({ receiver: receiver, amount: amtVal });
        }
        var aggregated = {};
        for (var pi = 0; pi < parsed.length; pi++) {
          var uid2 = parsed[pi].receiver.userId;
          if (aggregated[uid2]) aggregated[uid2].amount += parsed[pi].amount;
          else aggregated[uid2] = { receiver: parsed[pi].receiver, amount: parsed[pi].amount };
        }
        var finalPayments = Object.values(aggregated);
        if (errors.length > 0 && finalPayments.length === 0) return ctx.reply("<b>Errors</b>\n\n<blockquote>" + errors.join("\n") + "</blockquote>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Try Again", callback_data: "qp_retry", style: "primary" }]] } }).catch(() => { });
        if (finalPayments.length === 0) return ctx.reply("No valid payments!", { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        var totalAmount = finalPayments.reduce(function(sum, p) { return sum + p.amount; }, 0);
        var sender = await getUser(userId);
        var isPriv = (await isAdmin(userId)) || (await isOwner(userId)) || (await isWhitelisted(userId));
        var unlimited2 = await getConfig("quick_pay_unlimited", true);
        var negativeAllowed = await getConfig("quick_pay_negative_balance", false);
        var skipBalance = isPriv && unlimited2;
        if (!skipBalance && !negativeAllowed && sender.balance < totalAmount) return ctx.reply("<b>Insufficient Balance!</b>\n\n<blockquote>Your: " + RUPEE + sender.balance.toFixed(2) + "\nRequired: " + RUPEE + totalAmount.toFixed(2) + "</blockquote>", { parse_mode: "HTML", reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        global.quickPayCache = global.quickPayCache || {};
        global.quickPayCache[userId] = { payments: finalPayments };
        var bodyText = "";
        finalPayments.forEach(function(p, i) { bodyText += (i + 1) + ". " + (p.receiver.firstName || "User") + "\nUser ID: " + p.receiver.userId + "\nUsername: " + (p.receiver.username ? "@" + p.receiver.username : "None") + "\nAmount: " + RUPEE + p.amount + "\n\n"; });
        bodyText += "Total Users: " + finalPayments.length + "\nTotal Amount: " + RUPEE + totalAmount.toFixed(2) + "\n";
        if (skipBalance) bodyText += "Mode: 👑 Admin/Owner (Unlimited)\n";
        else bodyText += "Your Balance: " + RUPEE + sender.balance.toFixed(2) + "\nAfter: " + RUPEE + (sender.balance - totalAmount).toFixed(2);
        userState[userId] = "QP_CONFIRM_MULTI";
        return ctx.reply("<b>Confirm Payment</b>\n\n<blockquote>" + bodyText + "</blockquote>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Confirm ✅", callback_data: "qp_confirm_multi", style: "success" }, { text: "Cancel ❌", callback_data: "qp_cancel", style: "danger" }]] } }).catch(() => { });
      }
      if (state.indexOf("QP_AMOUNT_") === 0) {
        var targetId = parseInt(state.replace("QP_AMOUNT_", ""), 10);
        delete userState[userId];
        var amountQP = parseFloat(text);
        if (isNaN(amountQP) || amountQP <= 0) return ctx.reply("❌ Invalid amount!", { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        var target = await User.findOne({ userId: targetId }).lean();
        if (!target) return ctx.reply("❌ User not found", { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        var senderQP = await getUser(userId);
        var isPriv2 = (await isAdmin(userId)) || (await isOwner(userId)) || (await isWhitelisted(userId));
        var unlimited3 = await getConfig("quick_pay_unlimited", true);
        var negAllowed = await getConfig("quick_pay_negative_balance", false);
        var skipBal = isPriv2 && unlimited3;
        if (!skipBal && !negAllowed && senderQP.balance < amountQP) return ctx.reply("❌ Insufficient! " + RUPEE + senderQP.balance.toFixed(2), { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        global.quickPayCache = global.quickPayCache || {};
        global.quickPayCache[userId] = { payments: [{ receiver: target, amount: amountQP }] };
        var bodyText2 = "To: " + (target.firstName || "User") + "\nUser ID: " + target.userId + "\nUsername: " + (target.username ? "@" + target.username : "None") + "\nAmount: " + RUPEE + amountQP + "\n\nYour Balance: " + RUPEE + senderQP.balance.toFixed(2);
        userState[userId] = "QP_CONFIRM_MULTI";
        return ctx.reply("<b>Confirm Payment</b>\n\n<blockquote>" + bodyText2 + "</blockquote>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Confirm ✅", callback_data: "qp_confirm_multi", style: "success" }, { text: "Cancel ❌", callback_data: "qp_cancel", style: "danger" }]] } }).catch(() => { });
      }
      if (state === "WAITING_FOR_GIFT_REDEEM") {
        delete userState[userId];
        var gift = await GiftCode.findOneAndUpdate({ code: text, type: "redeem", usedUsers: { $ne: userId }, $expr: { $lt: [{ $size: "$usedUsers" }, "$maxUses"] } }, { $push: { usedUsers: userId } }, { new: true });
        if (!gift) return ctx.reply("🚫 Invalid or expired!", { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
        var userG = await getUser(userId);
        userG.balance += gift.amount;
        await userG.save();
        await logBalanceHistory(userId, "Gift Redeemed (" + gift.code + ")", gift.amount);
        return ctx.reply("🎉 Gift redeemed! Added " + RUPEE + gift.amount + ".", { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
      }
      return;
    }
    if (text.indexOf("/") === 0) return next();
    var userF = await getUser(userId);
    var layout = await getCurrentKeyboardLayoutForUser(userId);
    var findKeyByName = function(name) {
      var btn = layout.find(function(b) { return b.name === name && !b.hidden; });
      return btn ? btn.key : null;
    };
    var matchedKey = findKeyByName(text);
    var isAdminUser = await isAdmin(userId);
    if (matchedKey && !isAdminUser) {
      var isJoined = await checkForceJoin(ctx);
      if (!isJoined) return sendForceJoinMessage(ctx);
    }
    if (matchedKey === "btn_balance") {
      try { await sendBalancePage(ctx, false, true); } catch (err) { return ctx.reply("❌ Error: " + err.message).catch(() => { }); }
      return;
    } else if (matchedKey === "btn_tasks") {
      try {
        var tasks = await Task.find({ isActive: { $ne: false }, isComplete: true }).sort({ createdAt: -1 }).lean();
        if (!tasks || tasks.length === 0) return ctx.reply("No tasks available.", { parse_mode: "HTML" }).catch(() => { });
        var taskButtons = [];
        tasks.forEach(function(t) { taskButtons.push([{ text: t.title + " (" + RUPEE + t.reward + ")", callback_data: "do_task_" + t.taskId, style: "primary" }]); });
        return ctx.reply("<b>Available Tasks</b>", { reply_markup: { inline_keyboard: taskButtons }, parse_mode: "HTML" }).catch(() => { });
      } catch (e) { return ctx.reply("❌ Error loading tasks.", { parse_mode: "HTML" }).catch(() => { }); }
    } else if (matchedKey === "btn_gift") {
      userState[userId] = "WAITING_FOR_GIFT_REDEEM";
      return ctx.reply("🎁 Gift Code\n\nSend Gift Code To Claim Reward!", { parse_mode: "HTML" }).catch(() => { });
    } else if (matchedKey === "btn_quickpay") {
      var qpEnabled = await getConfig("quick_pay_enabled", true);
      if (!qpEnabled) return ctx.reply("⚠️ Quick Pay is currently disabled.", { parse_mode: "HTML" }).catch(() => { });
      var title = "💡" + toSmallCaps("Quick Pay To a Simple User Payment Send");
      var openingUsername = ctx.from.username ? "@" + ctx.from.username : "No Username";
      var adminId = await getConfig("owner_id", MAIN_OWNER_ID);
      var bodyText3 = toSmallCaps("You Can Also Use The Format Below To Process Payments For One or Multiple Users:") + "\n\n" + toSmallCaps("Format") + " :\n<code>" + userId + " 5</code>     <code>" + openingUsername + " 5</code>\n<code>" + adminId + " 10</code>     <code>@username 10</code>";
      userState[userId] = "QP_WAIT_INPUT";
      var kbQP = new Keyboard().requestUsers(toSmallCaps("Select User"), 1, { user_is_bot: false, request_name: true, request_username: true }).row().text("❌ Cancel").resized();
      return ctx.reply(title + "\n\n<blockquote>" + bodyText3 + "</blockquote>", { parse_mode: "HTML", reply_markup: kbQP }).catch(() => { });
    } else if (matchedKey === "btn_payout") {
      return sendPayoutMethodPage(ctx, false);
    } else if (matchedKey === "btn_withdraw") {
      var withdrawEnabled = await getConfig("withdraw_enabled", true);
      if (!withdrawEnabled) {
        var isAdminU = await isAdmin(userId);
        if (!isAdminU) return ctx.reply("⚠️ Withdrawals are currently disabled", { parse_mode: "HTML" }).catch(() => { });
      }
      var buttons = await buildWithdrawMenu();
      if (buttons.length === 0) return ctx.reply("<b>Choose Withdraw Method</b>\n\n❌ No withdraw methods available.", { parse_mode: "HTML" }).catch(() => { });
      userState[userId] = "AWAITING_WITHDRAW_METHOD";
      return ctx.reply("<b>Choose Withdraw Method</b>", { reply_markup: { inline_keyboard: buttons }, parse_mode: "HTML" }).catch(() => { });
    } else {
      var gift2 = await GiftCode.findOneAndUpdate({ code: text, type: "redeem", usedUsers: { $ne: userId }, $expr: { $lt: [{ $size: "$usedUsers" }, "$maxUses"] } }, { $push: { usedUsers: userId } }, { new: true }).catch(function() { return null; });
      if (gift2) {
        userF.balance += gift2.amount;
        await userF.save();
        await logBalanceHistory(userId, "Gift Redeemed (" + gift2.code + ")", gift2.amount);
        return ctx.reply("🎉 Added " + RUPEE + gift2.amount + "!", { reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
      }
      return sendUnknownCommand(ctx);
    }
  } catch (e) { console.error("message:text error:", e.message); }
});

async function handleAdminTextInput(ctx, text, userId, state) {
  try {
    if (!(await isAdmin(userId))) return false;
    if (state.indexOf("TAX_ADD_") === 0 || state.indexOf("TAX_EDIT_") === 0) {
      var handledTax = await handleAdminTaxInput(ctx, text, userId, state);
      if (handledTax) return true;
    }
    if (state === "USER_UPDATE_BROADCAST") return await handleUserUpdateBroadcast(ctx, text, userId);
    if (state === "AUTO_BANK_ADD" || state.indexOf("AUTO_BANK_PAYOUT_") === 0) {
      var handledAB = await handleAutoBankInput(ctx, text, userId, state);
      if (handledAB) return true;
    }
    var adminOnlyPrefixes = ["BROADCAST_WAIT_MSG", "BROADCAST_ADD_BUTTONS", "BROADCAST_TO_CHANNELS", "WAITING_ADMIN_ADD", "WAITING_NEW_OWNER", "WAITING_TAX_PERCENT", "QP_SET_TAX", "BAN_USER_WAIT", "UNBAN_USER_WAIT", "BAN_WALLET_WAIT", "WAITING_FOR_ADD_BAL", "WAITING_FOR_REM_BAL", "WAITING_FOR_TRACKER_ID", "WAITING_FOR_USER_MESSAGE", "TASK_FIELD_NAME", "TASK_FIELD_REWARD", "TASK_FIELD_LINK", "TASK_FIELD_DESC", "TASK_FIELD_CUSTOM_TIME", "TASK_EDIT_TITLE_", "TASK_EDIT_REWARD_", "TASK_EDIT_LINK_", "TASK_EDIT_CHANNEL_", "WAITING_TASK_ALERT_CHANNEL", "TASK_SEARCH", "WAITING_REDEEM_CODES", "WAITING_AMAZON_CODES", "LIVEFUND_WAIT_AMOUNT", "CH_EDIT_LINK_", "SL_EDIT_", "EDIT_WELCOME_TEXT", "EDIT_FOOTER_TEXT", "EDIT_START_TITLE", "EDIT_START_LINK_PREFIX", "EDIT_START_LINK_CLICKABLE", "EDIT_START_URL", "SUPPORT_SET", "GW_WAIT_NAME_V2", "GW_WAIT_URL_V2_", "GW_EDIT_URL_", "GW_MIN_", "GW_MAX_", "GW_PAYOUT_", "ADD_CHANNEL_WAIT", "SET_PAYOUT_CHANNEL", "ADD_SOCIAL_LINK", "ADMWD_MIN_", "ADMWD_MAX_", "UADD_WAIT_", "UREM_WAIT_", "UMSG_WAIT_", "UNKNOWN_CMD_EDIT_TEXT", "KBC_EDIT_NAME_", "APC_EDIT_NAME_", "QP_WHITELIST_ADD", "QP_WHITELIST_REMOVE", "AUTO_UPI_SIMPLE_NAME", "AUTO_UPI_SIMPLE_URL_", "AUTO_UPI_ADVANCED_INPUT", "AUTO_UPI_EDIT_NAME_", "AUTO_UPI_EDIT_URL_", "AUTO_UPI_MIN_", "AUTO_UPI_MAX_", "AUTO_UPI_PAYOUT_"];
    var isAdminOnly = adminOnlyPrefixes.some(function(p) { return state === p || (p.slice(-1) === "_" && state.indexOf(p) === 0); });
    if (!isAdminOnly) return false;
    if (state === "BROADCAST_WAIT_MSG") {
      var html = entitiesToHtml(text, ctx.message.entities || []);
      global.broadcastCache = global.broadcastCache || {};
      global.broadcastCache[userId] = { type: "text", content: html, mode: "direct", buttonRows: null, fromChatId: ctx.chat.id, fromMessageId: ctx.message.message_id };
      delete userState[userId];
      await renderBroadcastConfirm(ctx, global.broadcastCache[userId]);
      return true;
    }
    if (state === "BROADCAST_ADD_BUTTONS") {
      delete userState[userId];
      var cacheObj = global.broadcastCache && global.broadcastCache[userId];
      if (!cacheObj) { await ctx.reply("❌ Session expired").catch(() => { }); return true; }
      var rows = parseInlineButtons(text);
      if (!rows || rows.length === 0) { await ctx.reply("❌ Invalid format!").catch(() => { }); return true; }
      cacheObj.buttonRows = rows;
      await renderBroadcastConfirm(ctx, cacheObj);
      return true;
    }
    if (state === "BROADCAST_TO_CHANNELS") {
      var html2 = entitiesToHtml(text, ctx.message.entities || []);
      var channels = await Channel.find({ isActive: true }).lean();
      var sent = 0, failed = 0;
      for (var ci = 0; ci < channels.length; ci++) {
        try { await bot.api.sendMessage(channels[ci].channelId, html2, { parse_mode: "HTML" }).catch(function() { throw new Error("x"); }); sent++; } catch (e) { failed++; }
      }
      delete userState[userId];
      await ctx.reply("<b>Broadcast Complete!</b>\n\n<blockquote>✅ Sent: " + sent + "\n❌ Failed: " + failed + "</blockquote>", { parse_mode: "HTML" }).catch(() => { });
      return true;
    }
    if (state.indexOf("KBC_EDIT_NAME_") === 0) {
      var btnKey = state.replace("KBC_EDIT_NAME_", "");
      delete userState[userId];
      var layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
      var btn = layout.find(function(b) { return b.key === btnKey; });
      if (btn) { btn.name = text; configCache.data["keyboard_layout"] = layout; await setConfig("keyboard_layout", layout); }
      await ctx.reply("✅ Button name updated!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_keyboard_custom", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state.indexOf("APC_EDIT_NAME_") === 0) {
      var btnKey2 = state.replace("APC_EDIT_NAME_", "");
      delete userState[userId];
      var layout2 = configCache.data["admin_panel_layout"] || DEFAULT_ADMIN_PANEL_LAYOUT;
      var btn2 = layout2.find(function(b) { return b.key === btnKey2; });
      if (btn2) { btn2.name = text; configCache.data["admin_panel_layout"] = layout2; await setConfig("admin_panel_layout", layout2); }
      await ctx.reply("✅ Button name updated!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_panel_custom", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state === "UNKNOWN_CMD_EDIT_TEXT") {
      delete userState[userId];
      await setConfig("unknown_command_text", text);
      await ctx.reply("✅ Saved\n\nNew Text:\n" + escapeHtml(text), { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_unknown_cmd", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state === "WAITING_ADMIN_ADD") {
      delete userState[userId];
      var input = text.trim();
      var targetUser = null;
      if (/^\d+$/.test(input)) targetUser = await User.findOne({ userId: parseInt(input, 10) });
      else { var cu = input.replace(/^@/, "").toLowerCase(); targetUser = await User.findOne({ username: { $regex: new RegExp("^" + cu + "$", "i") } }); }
      if (!targetUser) { await ctx.reply("❌ User not found!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_permissions", style: "primary" }]] } }).catch(() => { }); return true; }
      await BotAdmin.findOneAndUpdate({ userId: targetUser.userId }, { addedAt: new Date(), addedBy: userId, isActive: true }, { upsert: true });
      await logAdminAction(userId, ctx.from.first_name || "Owner", "Admin Added", String(targetUser.userId), 0, targetUser.userId);
      await ctx.reply("✅ <b>Admin added successfully!</b>\n\n👤 " + (targetUser.firstName || "User") + "\n🆔 <code>" + targetUser.userId + "</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_permissions", style: "primary" }]] } }).catch(() => { });
      try { await ctx.api.sendMessage(targetUser.userId, "🎉 <b>Congratulations!</b>\nYou are now Admin!\n\nUse /admin to open Admin Panel.", { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
      return true;
    }
    if (state === "WAITING_NEW_OWNER") {
      delete userState[userId];
      var newOwnerId = parseInt(text.trim(), 10);
      if (isNaN(newOwnerId)) { await ctx.reply("❌ Invalid ID!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admin", style: "primary" }]] } }).catch(() => { }); return true; }
      var tu = await User.findOne({ userId: newOwnerId });
      if (!tu) { await ctx.reply("❌ User not found!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admin", style: "primary" }]] } }).catch(() => { }); return true; }
      await ctx.reply("⚠️ <b>Confirm Transfer?</b>\n\n👑 New Owner: " + (tu.firstName || "User") + "\n🆔 <code>" + newOwnerId + "</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Confirm ✅", callback_data: "admin_transfer_confirm_" + newOwnerId, style: "success" }], [{ text: "Cancel", callback_data: "admin", style: "danger" }]] } }).catch(() => { });
      return true;
    }
    if (state === "WAITING_TAX_PERCENT") {
      delete userState[userId];
      var amt = parseFloat(text);
      if (isNaN(amt) || amt < 0 || amt > 50) { await ctx.reply("❌ Tax must be 0-50%!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_set_wd_tax", style: "primary" }]] } }).catch(() => { }); return true; }
      await setConfig("tax_percent", amt);
      await ctx.reply("✅ Tax: " + amt + "%", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_set_wd_tax", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state === "QP_SET_TAX") {
      delete userState[userId];
      var amt2 = parseFloat(text);
      if (isNaN(amt2) || amt2 < 0 || amt2 > 50) { await ctx.reply("❌ Tax must be 0-50%!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_quick_pay", style: "primary" }]] } }).catch(() => { }); return true; }
      await setConfig("quick_pay_tax_percent", amt2);
      await ctx.reply("✅ Quick Pay Tax: " + amt2 + "%", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_quick_pay", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state === "QP_WHITELIST_ADD") {
      delete userState[userId];
      var tid = parseInt(text.trim(), 10);
      if (isNaN(tid)) { await ctx.reply("❌ Invalid User ID!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "qp_whitelist", style: "primary" }]] } }).catch(() => { }); return true; }
      var tu2 = await User.findOne({ userId: tid });
      if (!tu2) { await ctx.reply("❌ User not found! Ask them to /start first.", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "qp_whitelist", style: "primary" }]] } }).catch(() => { }); return true; }
      var wl = await getConfig("quick_pay_whitelist", []);
      if (!Array.isArray(wl)) wl = [];
      if (wl.indexOf(tid) >= 0) { await ctx.reply("⚠️ Already whitelisted!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "qp_whitelist", style: "primary" }]] } }).catch(() => { }); return true; }
      wl.push(tid);
      await setConfig("quick_pay_whitelist", wl);
      await ctx.reply("✅ User added to whitelist!\n\n👤 " + (tu2.firstName || "User") + "\n🆔 <code>" + tid + "</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "qp_whitelist", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state === "QP_WHITELIST_REMOVE") {
      delete userState[userId];
      var tid2 = parseInt(text.trim(), 10);
      if (isNaN(tid2)) { await ctx.reply("❌ Invalid User ID!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "qp_whitelist", style: "primary" }]] } }).catch(() => { }); return true; }
      var wl2 = await getConfig("quick_pay_whitelist", []);
      if (!Array.isArray(wl2)) wl2 = [];
      var idx = wl2.indexOf(tid2);
      if (idx === -1) { await ctx.reply("⚠️ Not in whitelist!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "qp_whitelist", style: "primary" }]] } }).catch(() => { }); return true; }
      wl2.splice(idx, 1);
      await setConfig("quick_pay_whitelist", wl2);
      await ctx.reply("✅ User removed from whitelist!\n\n🆔 <code>" + tid2 + "</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "qp_whitelist", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state === "BAN_USER_WAIT") {
      delete userState[userId];
      var tid3 = parseInt(text, 10);
      if (isNaN(tid3)) { await ctx.reply("❌ Invalid!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_manage_ban", style: "primary" }]] } }).catch(() => { }); return true; }
      var tu3 = await User.findOne({ userId: tid3 });
      if (!tu3) { await ctx.reply("❌ User not found!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_manage_ban", style: "primary" }]] } }).catch(() => { }); return true; }
      tu3.isBanned = true;
      await tu3.save();
      try { await ctx.api.sendMessage(tid3, "🚫 You have been banned from using this bot.").catch(() => { }); } catch (e) { }
      await ctx.reply("✅ User " + tid3 + " BANNED", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_manage_ban", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state === "UNBAN_USER_WAIT") {
      delete userState[userId];
      var tid4 = parseInt(text, 10);
      if (isNaN(tid4)) { await ctx.reply("❌ Invalid!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_manage_ban", style: "primary" }]] } }).catch(() => { }); return true; }
      var tu4 = await User.findOne({ userId: tid4 });
      if (!tu4) { await ctx.reply("❌ User not found!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_manage_ban", style: "primary" }]] } }).catch(() => { }); return true; }
      tu4.isBanned = false;
      await tu4.save();
      try { await ctx.api.sendMessage(tid4, "✅ You have been unbanned. Welcome back!").catch(() => { }); } catch (e) { }
      await ctx.reply("✅ User " + tid4 + " UNBANNED", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_manage_ban", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state === "BAN_WALLET_WAIT") {
      delete userState[userId];
      await setConfig("banned_wallet", text);
      await ctx.reply("✅ Wallet Banned: " + text, { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_manage_ban_wallet", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state === "WAITING_FOR_ADD_BAL") {
      delete userState[userId];
      var parts3 = text.trim().split(/\s+/).filter(function(p) { return p !== ""; });
      if (parts3.length < 2) { await ctx.reply("❌ Format: <code>UserID/@username Amount</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admin", style: "primary" }]] } }).catch(() => { }); return true; }
      var input3 = parts3[0].trim();
      var amount3 = parseFloat(parts3[parts3.length - 1]);
      if (isNaN(amount3) || amount3 <= 0) { await ctx.reply("❌ Invalid amount!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admin", style: "primary" }]] } }).catch(() => { }); return true; }
      var tu5 = null;
      if (/^\d+$/.test(input3)) tu5 = await User.findOne({ userId: parseInt(input3, 10) });
      else { var cu2 = input3.replace(/^@/, "").toLowerCase(); tu5 = await User.findOne({ username: { $regex: new RegExp("^" + cu2 + "$", "i") } }); }
      if (!tu5) { await ctx.reply("❌ User not found!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admin", style: "primary" }]] } }).catch(() => { }); return true; }
      tu5.balance += amount3;
      await tu5.save();
      await logBalanceHistory(tu5.userId, "Admin Added Balance", amount3);
      await logAdminAction(userId, ctx.from.first_name || "Admin", "Added Balance", "+" + RUPEE + amount3 + " to " + tu5.userId, amount3, tu5.userId);
      try { await ctx.api.sendMessage(tu5.userId, "💰 Admin Gave You A Increase In Balance By " + amount3).catch(() => { }); } catch (e) { }
      await ctx.reply("💸 Admin Added " + RUPEE + amount3.toFixed(2) + "\n\n👤 User: " + (tu5.firstName || "User") + " (<code>" + tu5.userId + "</code>)\n💰 Now Balance: " + formatBalance(tu5.balance), { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admin", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state === "WAITING_FOR_REM_BAL") {
      delete userState[userId];
      var parts4 = text.trim().split(/\s+/).filter(function(p) { return p !== ""; });
      if (parts4.length < 2) { await ctx.reply("❌ Format: <code>UserID/@username Amount</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admin", style: "primary" }]] } }).catch(() => { }); return true; }
      var input4 = parts4[0].trim();
      var amount4 = parseFloat(parts4[parts4.length - 1]);
      if (isNaN(amount4) || amount4 <= 0) { await ctx.reply("❌ Invalid amount!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admin", style: "primary" }]] } }).catch(() => { }); return true; }
      var tu6 = null;
      if (/^\d+$/.test(input4)) tu6 = await User.findOne({ userId: parseInt(input4, 10) });
      else { var cu3 = input4.replace(/^@/, "").toLowerCase(); tu6 = await User.findOne({ username: { $regex: new RegExp("^" + cu3 + "$", "i") } }); }
      if (!tu6) { await ctx.reply("❌ User not found!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admin", style: "primary" }]] } }).catch(() => { }); return true; }
      tu6.balance -= amount4;
      await tu6.save();
      await logBalanceHistory(tu6.userId, "Admin Removed Balance", -amount4);
      try { await ctx.api.sendMessage(tu6.userId, "💰 Admin Gave You A Decrease In Balance By " + amount4).catch(() => { }); } catch (e) { }
      await ctx.reply("💸 Admin Removed " + RUPEE + amount4.toFixed(2) + "\n\n👤 User: " + (tu6.firstName || "User") + " (<code>" + tu6.userId + "</code>)\n💰 Now Balance: " + formatBalance(tu6.balance), { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admin", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state === "WAITING_FOR_TRACKER_ID") {
      delete userState[userId];
      var tid5 = parseInt(text, 10);
      if (isNaN(tid5)) { await ctx.reply("❌ Invalid!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admin", style: "primary" }]] } }).catch(() => { }); return true; }
      var tu7 = await User.findOne({ userId: tid5 });
      if (!tu7) { await ctx.reply("❌ User not found!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admin", style: "primary" }]] } }).catch(() => { }); return true; }
      await ctx.reply("👤 Loading user <code>" + tid5 + "</code>...", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "View Details", callback_data: "user_detail_" + tid5, style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state === "WAITING_FOR_USER_MESSAGE") {
      delete userState[userId];
      var parts5 = text.split("|").map(function(p) { return p.trim(); });
      if (parts5.length < 2) { await ctx.reply("❌ Format: <code>UserID | Message</code>", { parse_mode: "HTML" }).catch(() => { }); return true; }
      var tid6 = parseInt(parts5[0], 10);
      var message = parts5.slice(1).join("|").trim();
      if (isNaN(tid6)) { await ctx.reply("❌ Invalid User ID!").catch(() => { }); return true; }
      try { await ctx.api.sendMessage(tid6, "📨 <b>Admin Message</b>\n\n" + message, { parse_mode: "HTML" }).catch(() => { }); await ctx.reply("✅ Sent to <code>" + tid6 + "</code>!", { parse_mode: "HTML" }).catch(() => { }); }
      catch (e) { await ctx.reply("❌ Failed: " + e.message).catch(() => { }); }
      return true;
    }
    if (state === "TASK_FIELD_NAME") {
      delete userState[userId];
      var temp = global.taskCreation && global.taskCreation[userId];
      if (!temp) { await ctx.reply("❌ Session expired", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_create_start", style: "primary" }]] } }).catch(() => { }); return true; }
      temp.title = text.trim();
      await ctx.reply("✅ Task Name: " + text.trim(), { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_create_start", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state === "TASK_FIELD_REWARD") {
      delete userState[userId];
      var amtR = parseFloat(text);
      if (isNaN(amtR) || amtR <= 0) { await ctx.reply("❌ Invalid amount!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_create_start", style: "primary" }]] } }).catch(() => { }); return true; }
      var tempR = global.taskCreation && global.taskCreation[userId];
      if (!tempR) { await ctx.reply("❌ Session expired", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_create_start", style: "primary" }]] } }).catch(() => { }); return true; }
      tempR.reward = amtR;
      await ctx.reply("✅ Reward: " + RUPEE + amtR, { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_create_start", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state === "TASK_FIELD_LINK") {
      delete userState[userId];
      var link = text.trim();
      if (link.indexOf("http") !== 0) { await ctx.reply("❌ Invalid link!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_create_start", style: "primary" }]] } }).catch(() => { }); return true; }
      var tempL = global.taskCreation && global.taskCreation[userId];
      if (!tempL) { await ctx.reply("❌ Session expired", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_create_start", style: "primary" }]] } }).catch(() => { }); return true; }
      tempL.link = link;
      await ctx.reply("✅ Link: " + link, { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_create_start", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state === "TASK_FIELD_DESC") {
      delete userState[userId];
      var tempD = global.taskCreation && global.taskCreation[userId];
      if (!tempD) { await ctx.reply("❌ Session expired", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_create_start", style: "primary" }]] } }).catch(() => { }); return true; }
      tempD.description = text.trim();
      await ctx.reply("✅ Description: " + text.trim(), { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_create_start", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state === "TASK_FIELD_CUSTOM_TIME") {
      delete userState[userId];
      var minutes = parseInt(text.trim(), 10);
      if (isNaN(minutes) || minutes <= 0) { await ctx.reply("❌ Invalid!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_create_start", style: "primary" }]] } }).catch(() => { }); return true; }
      var tempT = global.taskCreation && global.taskCreation[userId];
      if (!tempT) { await ctx.reply("❌ Session expired", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_create_start", style: "primary" }]] } }).catch(() => { }); return true; }
      tempT.expiryMinutes = minutes;
      await ctx.reply("✅ Time Limit: " + formatMinutes(minutes), { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_create_start", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state.indexOf("TASK_EDIT_TITLE_") === 0) { var t1 = state.replace("TASK_EDIT_TITLE_", ""); delete userState[userId]; await Task.updateOne({ taskId: t1 }, { title: text }); await ctx.reply("✅ Title updated!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "view_task_" + t1, style: "primary" }]] } }).catch(() => { }); return true; }
    if (state.indexOf("TASK_EDIT_REWARD_") === 0) { var t2 = state.replace("TASK_EDIT_REWARD_", ""); delete userState[userId]; var ar = parseFloat(text); if (isNaN(ar) || ar <= 0) { await ctx.reply("❌ Invalid!").catch(() => { }); return true; } await Task.updateOne({ taskId: t2 }, { reward: ar }); await ctx.reply("✅ Reward updated!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "view_task_" + t2, style: "primary" }]] } }).catch(() => { }); return true; }
    if (state.indexOf("TASK_EDIT_LINK_") === 0) { var t3 = state.replace("TASK_EDIT_LINK_", ""); delete userState[userId]; await Task.updateOne({ taskId: t3 }, { link: text }); await ctx.reply("✅ Link updated!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "view_task_" + t3, style: "primary" }]] } }).catch(() => { }); return true; }
    if (state.indexOf("TASK_EDIT_CHANNEL_") === 0) { var t4 = state.replace("TASK_EDIT_CHANNEL_", ""); delete userState[userId]; await Task.updateOne({ taskId: t4 }, { alertChannel: text }); await ctx.reply("✅ Alert Channel updated!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "view_task_" + t4, style: "primary" }]] } }).catch(() => { }); return true; }
    if (state === "WAITING_TASK_ALERT_CHANNEL") {
      delete userState[userId];
      var channelId = text.trim();
      if (channelId.indexOf("@") !== 0 && !/^-?\d+$/.test(channelId)) { await ctx.reply("❌ Invalid Channel!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_tasks_manager", style: "primary" }]] } }).catch(() => { }); return true; }
      try {
        await ctx.api.getChat(channelId);
        var botInfo = await ctx.api.getMe();
        var botMember = await ctx.api.getChatMember(channelId, botInfo.id);
        if (["administrator", "creator"].indexOf(botMember.status) < 0) { await ctx.reply("❌ Bot must be admin in channel!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_tasks_manager", style: "primary" }]] } }).catch(() => { }); return true; }
      } catch (e) { await ctx.reply("❌ Cannot access channel!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_tasks_manager", style: "primary" }]] } }).catch(() => { }); return true; }
      await setConfig("default_task_alert_channel", channelId);
      await ctx.reply("✅ Task Alert Channel set!\n\n📢 <code>" + channelId + "</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_tasks_manager", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state === "TASK_SEARCH") {
      delete userState[userId];
      var query = text.trim();
      var task = await Task.findOne({ $or: [{ taskId: query }, { title: { $regex: new RegExp("^" + query + "$", "i") } }, { title: { $regex: new RegExp(query, "i") } }] }).lean();
      if (!task) { await ctx.reply("❌ Task Not Found!", { reply_markup: { inline_keyboard: [[{ text: "Try Again", callback_data: "adm_search_task", style: "primary" }], [{ text: "Back", callback_data: "adm_tasks_manager", style: "primary" }]] } }).catch(() => { }); return true; }
      var bodyT = "Task ID: " + task.taskId + "\nName: " + task.title + "\nReward: " + RUPEE + task.reward + "\nLink: " + task.link + "\nStatus: " + (task.isActive !== false ? "🟢 ON" : "🔴 OFF");
      await ctx.reply("<b>Task Found!</b>\n\n<blockquote>" + bodyT + "</blockquote>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "View", callback_data: "view_task_" + task.taskId, style: "primary" }, { text: "Delete", callback_data: "del_task_" + task.taskId, style: "danger" }], [{ text: "Back", callback_data: "adm_tasks_manager", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state === "WAITING_REDEEM_CODES") { delete userState[userId]; await saveCodes(text, "redeem", ctx); return true; }
    if (state === "WAITING_AMAZON_CODES") { delete userState[userId]; await saveCodes(text, "amazon", ctx); return true; }
    if (state === "LIVEFUND_WAIT_AMOUNT") {
      delete userState[userId];
      var amtL = parseFloat(text);
      if (isNaN(amtL) || amtL < 0) { await ctx.reply("❌ Invalid amount!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "status_live_fund", style: "primary" }]] } }).catch(() => { }); return true; }
      await LiveFund.findOneAndUpdate({ key: "main_fund" }, { totalFund: amtL, usedFund: 0, updatedAt: new Date() }, { upsert: true });
      await ctx.reply("✅ Fund Set: " + RUPEE + amtL, { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "status_live_fund", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state.indexOf("CH_EDIT_LINK_") === 0) {
      var chId = state.replace("CH_EDIT_LINK_", "");
      delete userState[userId];
      var newLink = text.trim();
      if (newLink.indexOf("http") !== 0) { await ctx.reply("❌ Invalid link!").catch(() => { }); return true; }
      await Channel.updateOne({ channelId: chId }, { inviteLink: newLink });
      await ctx.reply("✅ Updated!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_manage_channels", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state.indexOf("SL_EDIT_") === 0) {
      var id = state.replace("SL_EDIT_", "");
      delete userState[userId];
      var parts6 = text.split("|").map(function(p) { return p.trim(); });
      if (parts6.length !== 2) { await ctx.reply("❌ Format: <code>Name | Link</code>", { parse_mode: "HTML" }).catch(() => { }); return true; }
      await SocialLink.findByIdAndUpdate(id, { name: parts6[0], link: parts6[1] });
      await ctx.reply("✅ Updated!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_manage_channels", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state === "EDIT_WELCOME_TEXT") { delete userState[userId]; var hw = entitiesToHtml(text, ctx.message.entities || []); await setConfig("balance_welcome_text", hw); await ctx.reply("✅ Welcome Message Updated!\n\n" + hw, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_edit_balance_text", style: "primary" }]] } }).catch(() => { }); return true; }
    if (state === "EDIT_FOOTER_TEXT") { delete userState[userId]; var hf = entitiesToHtml(text, ctx.message.entities || []); await setConfig("balance_footer_text", hf); await ctx.reply("✅ Footer Updated!\n\n❝ " + hf + " ❞", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_edit_balance_text", style: "primary" }]] } }).catch(() => { }); return true; }
    if (state === "EDIT_START_TITLE") { delete userState[userId]; var hst = entitiesToHtml(text, ctx.message.entities || []); await setConfig("start_title_text", hst); await ctx.reply("✅ Title Updated!\n\n" + hst, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_start_edit", style: "primary" }]] } }).catch(() => { }); return true; }
    if (state === "EDIT_START_LINK_PREFIX") { delete userState[userId]; var hsp = entitiesToHtml(text, ctx.message.entities || []); await setConfig("start_link_prefix", hsp); await ctx.reply("✅ Link Prefix Updated!", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_start_edit", style: "primary" }]] } }).catch(() => { }); return true; }
    if (state === "EDIT_START_LINK_CLICKABLE") { delete userState[userId]; var hsc = entitiesToHtml(text, ctx.message.entities || []); await setConfig("start_link_clickable", hsc); await ctx.reply("✅ Clickable Text Updated!", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_start_edit", style: "primary" }]] } }).catch(() => { }); return true; }
    if (state === "EDIT_START_URL") { delete userState[userId]; var inpu = text.trim(); if (!inpu) { await ctx.reply("❌ Invalid!").catch(() => { }); return true; } await setConfig("welcome_channel_link", inpu); var l = convertOwnerLink(inpu); await ctx.reply("✅ Link URL Updated!\n\n🔗 " + l, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_start_edit", style: "primary" }]] } }).catch(() => { }); return true; }
    if (state === "SUPPORT_SET") { delete userState[userId]; var input6 = text.trim(); if (!isValidTelegramID(input6)) { await ctx.reply("❌ INVALID INPUT!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_support", style: "primary" }]] } }).catch(() => { }); return true; } await setConfig("support_username", input6); var l2 = convertOwnerLink(input6); await ctx.reply("✅ Customer Support Set!\n\n🔗 " + l2, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_support", style: "primary" }]] } }).catch(() => { }); return true; }
    if (state === "GW_WAIT_NAME_V2") {
      var gwName3 = text.toUpperCase().replace(/\s+/g, "_");
      if (gwName3.length < 2) { await ctx.reply("❌ Name too short!").catch(() => { }); return true; }
      var existing = await Gateway.findOne({ name: gwName3 });
      if (existing) { delete userState[userId]; await ctx.reply("❌ Gateway already exists!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_gateway_list", style: "primary" }]] } }).catch(() => { }); return true; }
      userState[userId] = "GW_WAIT_URL_V2_" + gwName3;
      await ctx.reply("✅ Name: <b>" + gwName3 + "</b>\n\n🔗 Paste Your Gateway URL:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_gateway_list", style: "danger" }]] } }).catch(() => { });
      return true;
    }
    if (state.indexOf("GW_WAIT_URL_V2_") === 0) {
      var gwName4 = state.replace("GW_WAIT_URL_V2_", "");
      if (text.indexOf("http://") !== 0 && text.indexOf("https://") !== 0) { await ctx.reply("❌ URL must start with http", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_gateway_list", style: "primary" }]] } }).catch(() => { }); return true; }
      delete userState[userId];
      await Gateway.create({ name: gwName4, url: text.trim(), url_template: text.trim(), isActive: true, minAmount: 0, maxAmount: 0, taxPercent: 0, taxSlabs: [], createdBy: userId });
      await logAdminAction(userId, ctx.from.first_name || "Admin", "Gateway Added", gwName4, 0, null);
      await ctx.reply("✅ Gateway Created!\n\n📛 " + gwName4 + "\n🟢 ON", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_gateway_list", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state.indexOf("GW_EDIT_URL_") === 0) {
      var gwn = state.replace("GW_EDIT_URL_", "");
      delete userState[userId];
      if (text.indexOf("http") !== 0) { await ctx.reply("❌ Invalid URL!").catch(() => { }); return true; }
      await Gateway.findOneAndUpdate({ name: gwn }, { url: text.trim(), url_template: text.trim(), updatedAt: new Date() });
      await ctx.reply("✅ Gateway Updated!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "gw_view_" + gwn, style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state.indexOf("GW_MIN_") === 0) { var gwm = state.replace("GW_MIN_", ""); delete userState[userId]; var am = parseFloat(text); if (isNaN(am) || am < 0) { await ctx.reply("❌ Invalid!").catch(() => { }); return true; } await Gateway.updateOne({ name: gwm }, { minAmount: am, updatedAt: new Date() }); await ctx.reply("✅ Min: " + RUPEE + am, { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "gw_edit_" + gwm, style: "primary" }]] } }).catch(() => { }); return true; }
    if (state.indexOf("GW_MAX_") === 0) { var gwx = state.replace("GW_MAX_", ""); delete userState[userId]; var ax = parseFloat(text); if (isNaN(ax) || ax < 0) { await ctx.reply("❌ Invalid!").catch(() => { }); return true; } await Gateway.updateOne({ name: gwx }, { maxAmount: ax, updatedAt: new Date() }); await ctx.reply("✅ Max: " + RUPEE + ax, { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "gw_edit_" + gwx, style: "primary" }]] } }).catch(() => { }); return true; }
    if (state.indexOf("GW_PAYOUT_") === 0) {
      var gwp = state.replace("GW_PAYOUT_", "");
      delete userState[userId];
      try { await ctx.api.getChat(text.trim()); } catch (e) { await ctx.reply("❌ Cannot access channel!").catch(() => { }); return true; }
      await Gateway.updateOne({ name: gwp }, { payoutChannel: text.trim(), updatedAt: new Date() });
      await ctx.reply("✅ Payout Channel set!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "gw_view_" + gwp, style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state === "ADD_CHANNEL_WAIT") {
      delete userState[userId];
      var chId2 = text.trim();
      if (chId2.indexOf("@") !== 0 && !/^-?\d+$/.test(chId2)) { await ctx.reply("❌ Invalid Channel ID!").catch(() => { }); return true; }
      var existingCh = await Channel.findOne({ channelId: chId2 });
      if (existingCh) { await ctx.reply("❌ Channel already added!").catch(() => { }); return true; }
      try {
        var chatInfo = await ctx.api.getChat(chId2);
        var botInfo2 = await ctx.api.getMe();
        var botMember2 = await ctx.api.getChatMember(chId2, botInfo2.id);
        if (["administrator", "creator"].indexOf(botMember2.status) < 0) { await ctx.reply("❌ Bot must be admin in channel!").catch(() => { }); return true; }
        var inviteLink = "";
        try { if (chatInfo.invite_link) inviteLink = chatInfo.invite_link; else { var link = await ctx.api.createChatInviteLink(chId2, { name: "Auto", creates_join_request: false }); inviteLink = link.invite_link; } } catch (e) { }
        var maxOrder = await Channel.findOne({}).sort({ order: -1 }).lean();
        var newOrder = (maxOrder ? maxOrder.order : 0) + 1;
        await Channel.create({ channelId: chId2, inviteLink: inviteLink || ("https://t.me/" + chId2.replace("@", "")), displayName: chatInfo.title || chId2, isActive: true, isHidden: false, order: newOrder });
        await ctx.reply("✅ Added Successfully!\n\n📢 " + (chatInfo.title || chId2), { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_manage_channels", style: "primary" }]] } }).catch(() => { });
      } catch (e) { await ctx.reply("❌ Cannot access channel! " + e.message).catch(() => { }); return true; }
      return true;
    }
    if (state === "SET_PAYOUT_CHANNEL") {
      delete userState[userId];
      var pcId = text.trim();
      if (pcId.indexOf("@") !== 0 && !/^-?\d+$/.test(pcId)) { await ctx.reply("❌ Invalid!").catch(() => { }); return true; }
      try {
        await ctx.api.getChat(pcId);
        var bInfo = await ctx.api.getMe();
        var bMem = await ctx.api.getChatMember(pcId, bInfo.id);
        if (["administrator", "creator"].indexOf(bMem.status) < 0) { await ctx.reply("❌ Bot must be admin!").catch(() => { }); return true; }
      } catch (e) { await ctx.reply("❌ Cannot access: " + e.message).catch(() => { }); return true; }
      await setConfig("payout_channel", pcId);
      await ctx.reply("✅ Successfully Set!\n\n📢 Payout Channel:\n<code>" + pcId + "</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_manage_channels", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state === "ADD_SOCIAL_LINK") {
      delete userState[userId];
      var parts7 = text.split("|").map(function(p) { return p.trim(); });
      if (parts7.length !== 2) { await ctx.reply("❌ Format: <code>Name | Link</code>", { parse_mode: "HTML" }).catch(() => { }); return true; }
      await SocialLink.create({ name: parts7[0], link: parts7[1] });
      await ctx.reply("✅ Added!\n\n🔗 " + parts7[0], { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_manage_channels", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state.indexOf("ADMWD_MIN_") === 0) { var m1 = state.replace("ADMWD_MIN_", ""); delete userState[userId]; var av = parseFloat(text); if (isNaN(av) || av < 0) { await ctx.reply("❌ Invalid!").catch(() => { }); return true; } var ss = await WithdrawSettings.findOne({ method: m1 }); if (!ss) ss = await WithdrawSettings.create({ method: m1, isActive: false }); ss.minAmount = av; ss.updatedAt = new Date(); await ss.save(); await ctx.reply("✅ Min: " + RUPEE + av, { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admwd_edit_" + m1, style: "primary" }]] } }).catch(() => { }); return true; }
    if (state.indexOf("ADMWD_MAX_") === 0) { var m2 = state.replace("ADMWD_MAX_", ""); delete userState[userId]; var av2 = parseFloat(text); if (isNaN(av2) || av2 < 0) { await ctx.reply("❌ Invalid!").catch(() => { }); return true; } var ss2 = await WithdrawSettings.findOne({ method: m2 }); if (!ss2) ss2 = await WithdrawSettings.create({ method: m2, isActive: false }); ss2.maxAmount = av2; ss2.updatedAt = new Date(); await ss2.save(); await ctx.reply("✅ Max: " + RUPEE + av2, { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admwd_edit_" + m2, style: "primary" }]] } }).catch(() => { }); return true; }
    if (state.indexOf("UADD_WAIT_") === 0) {
      var tidA = parseInt(state.replace("UADD_WAIT_", ""), 10);
      delete userState[userId];
      var avA = parseFloat(text);
      if (isNaN(avA) || avA <= 0) { await ctx.reply("❌ Invalid!").catch(() => { }); return true; }
      var tuA = await User.findOne({ userId: tidA });
      if (!tuA) { await ctx.reply("❌ User not found!").catch(() => { }); return true; }
      tuA.balance += avA;
      await tuA.save();
      await logBalanceHistory(tidA, "Admin Added Balance", avA);
      try { await ctx.api.sendMessage(tidA, "💰 Admin Gave You A Increase In Balance By " + avA).catch(() => { }); } catch (e) { }
      await ctx.reply("✅ Added " + RUPEE + avA + ". New: " + formatBalance(tuA.balance), { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "user_detail_" + tidA, style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state.indexOf("UREM_WAIT_") === 0) {
      var tidB = parseInt(state.replace("UREM_WAIT_", ""), 10);
      delete userState[userId];
      var avB = parseFloat(text);
      if (isNaN(avB) || avB <= 0) { await ctx.reply("❌ Invalid!").catch(() => { }); return true; }
      var tuB = await User.findOne({ userId: tidB });
      if (!tuB) { await ctx.reply("❌ User not found!").catch(() => { }); return true; }
      tuB.balance -= avB;
      await tuB.save();
      await logBalanceHistory(tidB, "Admin Removed Balance", -avB);
      try { await ctx.api.sendMessage(tidB, "💰 Admin Gave You A Decrease In Balance By " + avB).catch(() => { }); } catch (e) { }
      await ctx.reply("✅ Removed " + RUPEE + avB + ". New: " + formatBalance(tuB.balance), { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "user_detail_" + tidB, style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state.indexOf("UMSG_WAIT_") === 0) {
      var tidC = parseInt(state.replace("UMSG_WAIT_", ""), 10);
      delete userState[userId];
      try { await ctx.api.sendMessage(tidC, "📨 <b>Message from Admin</b>\n\n" + text, { parse_mode: "HTML" }).catch(() => { }); await ctx.reply("✅ Sent to " + tidC, { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "user_detail_" + tidC, style: "primary" }]] } }).catch(() => { }); }
      catch (e) { await ctx.reply("❌ Failed: " + e.message).catch(() => { }); }
      return true;
    }
    if (state === "AUTO_UPI_SIMPLE_NAME") {
      var nameA = text.trim().toUpperCase();
      if (nameA.length < 2) { await ctx.reply("❌ Name too short!").catch(() => { }); return true; }
      var existsA = await AutoUpi.findOne({ name: nameA });
      if (existsA) { await ctx.reply("❌ Auto UPI already exists!").catch(() => { }); return true; }
      userState[userId] = "AUTO_UPI_SIMPLE_URL_" + nameA;
      await ctx.reply("📝 <b>Simple Model</b>\n\n✅ Name: <b>" + nameA + "</b>\n\nStep 2 of 2\n\n📝 Send API URL:\n\nExample:\n<code>https://api.cashfree.com/payout</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_auto_upi", style: "danger" }]] } }).catch(() => { });
      return true;
    }
    if (state.indexOf("AUTO_UPI_SIMPLE_URL_") === 0) {
      var nameB = state.replace("AUTO_UPI_SIMPLE_URL_", "");
      delete userState[userId];
      if (text.indexOf("http") !== 0) { await ctx.reply("❌ Invalid URL!").catch(() => { }); return true; }
      var gwIdA = "AUTO" + Date.now().toString().slice(-8);
      await AutoUpi.create({ gatewayId: gwIdA, name: nameB, apiUrl: text.trim(), method: "GET", status: "active", minAmount: 0, maxAmount: 0, taxPercent: 0, taxSlabs: [] });
      await ctx.reply("✅ <b>Auto UPI Added!</b>\n\n🌐 " + nameB + "\n🟢 ON\nMethod: GET\n\nURL:\n<code>" + text.trim() + "</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "View", callback_data: "auto_upi_view_" + gwIdA, style: "primary" }], [{ text: "Back", callback_data: "adm_auto_upi", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state === "AUTO_UPI_ADVANCED_INPUT") {
      delete userState[userId];
      var partsA = text.trim().split("::").map(function(p) { return p.trim(); });
      var nameC, methodA, urlA, apiKeyA = "";
      if (partsA.length === 4) { nameC = partsA[0].toUpperCase(); methodA = partsA[1].toUpperCase(); urlA = partsA[2]; apiKeyA = partsA[3]; }
      else if (partsA.length === 3) { nameC = partsA[0].toUpperCase(); methodA = partsA[1].toUpperCase(); urlA = partsA[2]; }
      else if (partsA.length === 2) { nameC = partsA[0].toUpperCase(); methodA = "GET"; urlA = partsA[1]; }
      else { await ctx.reply("❌ Invalid format!\nUse: <code>NAME::METHOD::URL::TOKEN</code>", { parse_mode: "HTML" }).catch(() => { }); return true; }
      if (!nameC || nameC.length < 2) { await ctx.reply("❌ Name too short!").catch(() => { }); return true; }
      if (["GET", "POST"].indexOf(methodA) < 0) methodA = "GET";
      if (urlA.indexOf("http") !== 0) { await ctx.reply("❌ Invalid URL!").catch(() => { }); return true; }
      var existsC = await AutoUpi.findOne({ name: nameC });
      if (existsC) { await ctx.reply("❌ Already exists!").catch(() => { }); return true; }
      var gwIdB = "AUTO" + Date.now().toString().slice(-8);
      await AutoUpi.create({ gatewayId: gwIdB, name: nameC, apiUrl: urlA, method: methodA, apiKey: apiKeyA, status: "active", minAmount: 0, maxAmount: 0, taxPercent: 0, taxSlabs: [] });
      await ctx.reply("✅ <b>Auto UPI Added!</b>\n\n🌐 " + nameC + "\n🟢 ON\nMethod: " + methodA + "\n" + (apiKeyA ? ("🔑 Token: <code>" + apiKeyA.substring(0, 8) + "...</code>\n") : "") + "\nURL:\n<code>" + urlA + "</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "View", callback_data: "auto_upi_view_" + gwIdB, style: "primary" }], [{ text: "Back", callback_data: "adm_auto_upi", style: "primary" }]] } }).catch(() => { });
      return true;
    }
    if (state.indexOf("AUTO_UPI_EDIT_NAME_") === 0) { var gId = state.replace("AUTO_UPI_EDIT_NAME_", ""); delete userState[userId]; var nn = text.trim().toUpperCase(); if (nn.length < 2) { await ctx.reply("❌ Too short!").catch(() => { }); return true; } await AutoUpi.updateOne({ gatewayId: gId }, { name: nn }); await ctx.reply("✅ Name updated: " + nn, { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "auto_upi_view_" + gId, style: "primary" }]] } }).catch(() => { }); return true; }
    if (state.indexOf("AUTO_UPI_EDIT_URL_") === 0) { var gId2 = state.replace("AUTO_UPI_EDIT_URL_", ""); delete userState[userId]; if (text.indexOf("http") !== 0) { await ctx.reply("❌ Invalid URL!").catch(() => { }); return true; } await AutoUpi.updateOne({ gatewayId: gId2 }, { apiUrl: text.trim() }); await ctx.reply("✅ URL updated", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "auto_upi_view_" + gId2, style: "primary" }]] } }).catch(() => { }); return true; }
    if (state.indexOf("AUTO_UPI_MIN_") === 0) { var gId3 = state.replace("AUTO_UPI_MIN_", ""); delete userState[userId]; var am3 = parseFloat(text); if (isNaN(am3) || am3 < 0) { await ctx.reply("❌ Invalid!").catch(() => { }); return true; } await AutoUpi.updateOne({ gatewayId: gId3 }, { minAmount: am3 }); await ctx.reply("✅ Min: " + RUPEE + am3, { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "auto_upi_edit_" + gId3, style: "primary" }]] } }).catch(() => { }); return true; }
    if (state.indexOf("AUTO_UPI_MAX_") === 0) { var gId4 = state.replace("AUTO_UPI_MAX_", ""); delete userState[userId]; var am4 = parseFloat(text); if (isNaN(am4) || am4 < 0) { await ctx.reply("❌ Invalid!").catch(() => { }); return true; } await AutoUpi.updateOne({ gatewayId: gId4 }, { maxAmount: am4 }); await ctx.reply("✅ Max: " + RUPEE + am4, { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "auto_upi_edit_" + gId4, style: "primary" }]] } }).catch(() => { }); return true; }
    if (state.indexOf("AUTO_UPI_PAYOUT_") === 0) {
      var gId5 = state.replace("AUTO_UPI_PAYOUT_", "");
      delete userState[userId];
      try { await ctx.api.getChat(text.trim()); } catch (e) { await ctx.reply("❌ Cannot access!").catch(() => { }); return true; }
      await AutoUpi.updateOne({ gatewayId: gId5 }, { payoutChannel: text.trim() });
      await ctx.reply("✅ Payout Channel set!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "auto_upi_view_" + gId5, style: "primary" }]] } }).catch(() => { });
      return true;
    }
    return true;
  } catch (e) { console.error("handleAdminTextInput error:", e.message); return true; }
}

bot.on("message:photo", async (ctx, next) => {
  var userId = ctx.from.id;
  var state = userState[userId];
  if (state && state.indexOf("WAITING_TASK_PHOTO_") === 0) {
    var taskId = state.replace("WAITING_TASK_PHOTO_", "");
    var task = await Task.findOne({ taskId: taskId });
    if (!task) { delete userState[userId]; return ctx.reply("Task not found!").catch(() => { }); }
    if (task.completedUsers.indexOf(userId) >= 0) { delete userState[userId]; return ctx.reply("Already completed!").catch(() => { }); }
    if (task.expiresAt && new Date(task.expiresAt) <= new Date()) { delete userState[userId]; return ctx.reply("Task expired!").catch(() => { }); }
    var photo = ctx.message.photo[ctx.message.photo.length - 1];
    var submissionId = Math.floor(100000 + Math.random() * 900000).toString();
    await TaskSubmission.create({ submissionId: submissionId, userId: userId, userName: ctx.from.first_name || "User", taskId: task.taskId, taskTitle: task.title, reward: task.reward, photoFileId: photo.file_id, status: "Pending" });
    delete userState[userId];
    await ctx.reply("Task Submitted!\n\nTask: " + task.title + "\nReward: " + RUPEE + task.reward + "\n\n🕐 Wait for admin approval.", { parse_mode: "HTML", reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
    var alertChannel = await getConfig("default_task_alert_channel", "Not Set");
    if (alertChannel && alertChannel !== "Not Set") {
      var userLink = '<a href="tg://user?id=' + userId + '">' + (ctx.from.first_name || "User") + " (" + userId + ")</a>";
      var caption = "<b>NEW TASK SUBMISSION</b>\n\nUser: " + userLink + "\nTask: " + task.title + "\nReward: " + RUPEE + task.reward + "\nLink: " + task.link + "\nType: Screenshot";
      var kb = { inline_keyboard: [[{ text: "Approve ✅", callback_data: "task_app_" + submissionId, style: "success" }, { text: "Reject ❌", callback_data: "task_rej_" + submissionId, style: "danger" }]] };
      try { await ctx.api.sendPhoto(alertChannel, photo.file_id, { caption: caption, parse_mode: "HTML", reply_markup: kb }).catch(() => { }); } catch (e) { }
    }
    return;
  }
  if (state === "BROADCAST_WAIT_MSG" && (await isAdmin(userId))) {
    var photo2 = ctx.message.photo[ctx.message.photo.length - 1];
    var caption2 = ctx.message.caption || "";
    var htmlCaption = entitiesToHtml(caption2, ctx.message.caption_entities || []);
    global.broadcastCache = global.broadcastCache || {};
    global.broadcastCache[userId] = { type: "photo", fileId: photo2.file_id, caption: htmlCaption, mode: "direct", buttonRows: null, fromChatId: ctx.chat.id, fromMessageId: ctx.message.message_id };
    delete userState[userId];
    return renderBroadcastConfirm(ctx, global.broadcastCache[userId]);
  }
  if (state === "BROADCAST_TO_CHANNELS" && (await isAdmin(userId))) {
    var photo3 = ctx.message.photo[ctx.message.photo.length - 1];
    var caption3 = ctx.message.caption || "";
    var channels = await Channel.find({ isActive: true }).lean();
    var sent = 0, failed = 0;
    for (var ci = 0; ci < channels.length; ci++) {
      try { await ctx.api.sendPhoto(channels[ci].channelId, photo3.file_id, { caption: caption3 }).catch(function() { throw new Error("x"); }); sent++; } catch (e) { failed++; }
    }
    delete userState[userId];
    return ctx.reply("<b>Broadcast Complete!</b>\n\n<blockquote>✅ Sent: " + sent + "\n❌ Failed: " + failed + "</blockquote>", { parse_mode: "HTML" }).catch(() => { });
  }
  return sendUnknownCommand(ctx);
});

bot.on("message:video", async (ctx, next) => {
  var userId = ctx.from.id;
  var state = userState[userId];
  if (state === "BROADCAST_WAIT_MSG" && (await isAdmin(userId))) {
    var video = ctx.message.video;
    var caption = ctx.message.caption || "";
    var htmlCaption = entitiesToHtml(caption, ctx.message.caption_entities || []);
    global.broadcastCache = global.broadcastCache || {};
    global.broadcastCache[userId] = { type: "video", fileId: video.file_id, caption: htmlCaption, mode: "direct", buttonRows: null, fromChatId: ctx.chat.id, fromMessageId: ctx.message.message_id };
    delete userState[userId];
    return renderBroadcastConfirm(ctx, global.broadcastCache[userId]);
  }
  return sendUnknownCommand(ctx);
});

bot.on("message:audio", async (ctx, next) => {
  var userId = ctx.from.id;
  var state = userState[userId];
  if (state === "BROADCAST_WAIT_MSG" && (await isAdmin(userId))) {
    var audio = ctx.message.audio;
    var caption = ctx.message.caption || "";
    var htmlCaption = entitiesToHtml(caption, ctx.message.caption_entities || []);
    global.broadcastCache = global.broadcastCache || {};
    global.broadcastCache[userId] = { type: "audio", fileId: audio.file_id, caption: htmlCaption, mode: "direct", buttonRows: null, fromChatId: ctx.chat.id, fromMessageId: ctx.message.message_id };
    delete userState[userId];
    return renderBroadcastConfirm(ctx, global.broadcastCache[userId]);
  }
  return sendUnknownCommand(ctx);
});

bot.on("message:document", async (ctx, next) => {
  var userId = ctx.from.id;
  var state = userState[userId];
  if (state === "BROADCAST_WAIT_MSG" && (await isAdmin(userId))) {
    var doc = ctx.message.document;
    var caption = ctx.message.caption || "";
    var htmlCaption = entitiesToHtml(caption, ctx.message.caption_entities || []);
    global.broadcastCache = global.broadcastCache || {};
    global.broadcastCache[userId] = { type: "document", fileId: doc.file_id, caption: htmlCaption, mode: "direct", buttonRows: null, fromChatId: ctx.chat.id, fromMessageId: ctx.message.message_id };
    delete userState[userId];
    return renderBroadcastConfirm(ctx, global.broadcastCache[userId]);
  }
  return sendUnknownCommand(ctx);
});

bot.on("message:sticker", async (ctx, next) => {
  var userId = ctx.from.id;
  var state = userState[userId];
  if (state === "BROADCAST_WAIT_MSG" && (await isAdmin(userId))) {
    var sticker = ctx.message.sticker;
    global.broadcastCache = global.broadcastCache || {};
    global.broadcastCache[userId] = { type: "sticker", fileId: sticker.file_id, mode: "direct", buttonRows: null, fromChatId: ctx.chat.id, fromMessageId: ctx.message.message_id };
    delete userState[userId];
    return renderBroadcastConfirm(ctx, global.broadcastCache[userId]);
  }
  return sendUnknownCommand(ctx);
});

bot.on("message:voice", async (ctx, next) => {
  var userId = ctx.from.id;
  var state = userState[userId];
  if (state === "BROADCAST_WAIT_MSG" && (await isAdmin(userId))) {
    var voice = ctx.message.voice;
    global.broadcastCache = global.broadcastCache || {};
    global.broadcastCache[userId] = { type: "voice", fileId: voice.file_id, mode: "direct", buttonRows: null, fromChatId: ctx.chat.id, fromMessageId: ctx.message.message_id };
    delete userState[userId];
    return renderBroadcastConfirm(ctx, global.broadcastCache[userId]);
  }
  return sendUnknownCommand(ctx);
});

bot.on("message:animation", async (ctx, next) => {
  var userId = ctx.from.id;
  var state = userState[userId];
  if (state === "BROADCAST_WAIT_MSG" && (await isAdmin(userId))) {
    var anim = ctx.message.animation;
    var caption = ctx.message.caption || "";
    var htmlCaption = entitiesToHtml(caption, ctx.message.caption_entities || []);
    global.broadcastCache = global.broadcastCache || {};
    global.broadcastCache[userId] = { type: "animation", fileId: anim.file_id, caption: htmlCaption, mode: "direct", buttonRows: null, fromChatId: ctx.chat.id, fromMessageId: ctx.message.message_id };
    delete userState[userId];
    return renderBroadcastConfirm(ctx, global.broadcastCache[userId]);
  }
  return sendUnknownCommand(ctx);
});

bot.on("message:users_shared", async (ctx) => {
  var userId = ctx.from.id;
  var state = userState[userId];
  if (state !== "QP_WAIT_INPUT") return;
  var shared = ctx.message.users_shared;
  if (!shared || !shared.users || shared.users.length === 0) return;
  var targetId = shared.users[0].user_id;
  var dbUser = await User.findOne({ userId: targetId }).lean();
  if (!dbUser) return ctx.reply("User not found in bot!\n\nAsk them to start the bot.", { parse_mode: "HTML" }).catch(() => { });
  if (targetId === userId) return ctx.reply("❌ Cannot pay yourself", { parse_mode: "HTML" }).catch(() => { });
  userState[userId] = "QP_AMOUNT_" + targetId;
  var bodyText = "Name: " + (dbUser.firstName || "User") + "\nUser ID: " + targetId + "\nUsername: " + (dbUser.username ? "@" + dbUser.username : "None");
  await ctx.reply("<b>User Selected</b>\n\n<blockquote>" + bodyText + "</blockquote>\n\nEnter Amount:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel ❌", callback_data: "qp_cancel", style: "danger" }]] } }).catch(() => { });
});

bot.on("message", async (ctx, next) => {
  var userId = ctx.from.id;
  var state = userState[userId];
  if (state === "BROADCAST_WAIT_MSG" && (await isAdmin(userId))) {
    var msg = ctx.message;
    var isForwarded = msg.forward_origin || msg.forward_from || msg.forward_from_chat || msg.forward_sender_name;
    if (isForwarded) {
      global.broadcastCache = global.broadcastCache || {};
      global.broadcastCache[userId] = { type: "forward", mode: "forward", buttonRows: null, fromChatId: ctx.chat.id, fromMessageId: msg.message_id };
      delete userState[userId];
      return renderBroadcastConfirm(ctx, global.broadcastCache[userId]);
    }
  }
  if (!state || state.indexOf("TASK_REFER_") !== 0) return next();
  var msg2 = ctx.message;
  var isForwarded2 = msg2.forward_origin || msg2.forward_from || msg2.forward_from_chat || msg2.forward_sender_name;
  if (!isForwarded2) return next();
  var taskId = state.replace("TASK_REFER_", "");
  delete userState[userId];
  var task = await Task.findOne({ taskId: taskId });
  if (!task) return ctx.reply("❌ Task not found").catch(() => { });
  if (task.completedUsers.indexOf(userId) >= 0) return ctx.reply("❌ Already completed!").catch(() => { });
  if (task.expiresAt && new Date(task.expiresAt) <= new Date()) return ctx.reply("❌ Task expired!").catch(() => { });
  var referValue = "";
  if (msg2.forward_origin) {
    if (msg2.forward_origin.type === "channel") referValue = "Channel: " + (msg2.forward_origin.chat.title || msg2.forward_origin.chat.username || msg2.forward_origin.chat.id);
    else if (msg2.forward_origin.type === "user") referValue = "User: " + (msg2.forward_origin.sender_user.first_name || msg2.forward_origin.sender_user.id);
    else if (msg2.forward_origin.type === "hidden_user") referValue = "Hidden: " + msg2.forward_origin.sender_user_name;
  } else if (msg2.forward_from_chat) referValue = "Channel: " + (msg2.forward_from_chat.title || msg2.forward_from_chat.username || msg2.forward_from_chat.id);
  else if (msg2.forward_from) referValue = "User: " + (msg2.forward_from.first_name || msg2.forward_from.id);
  else if (msg2.forward_sender_name) referValue = "Sender: " + msg2.forward_sender_name;
  if (!referValue) referValue = "Forwarded message";
  var submissionId = Math.floor(100000 + Math.random() * 900000).toString();
  var user = await getUser(userId);
  await TaskSubmission.create({ submissionId: submissionId, userId: userId, userName: user.firstName || "User", taskId: task.taskId, taskTitle: task.title, reward: task.reward, photoFileId: "REFER: " + referValue, status: "Pending" });
  var alertChannel = await getConfig("default_task_alert_channel", "Not Set");
  if (alertChannel && alertChannel !== "Not Set") {
    var forwardedMsgId = null;
    try { var fwd = await ctx.api.forwardMessage(alertChannel, ctx.chat.id, ctx.message.message_id); forwardedMsgId = fwd.message_id; } catch (e) { }
    var userLink = '<a href="tg://user?id=' + userId + '">' + (user.firstName || "User") + " (" + userId + ")</a>";
    var caption = "<b>NEW TASK SUBMISSION</b>\n\nUser: " + userLink + "\nTask: " + task.title + "\nReward: " + RUPEE + task.reward + "\nLink: " + task.link + "\nType: Refer";
    var kb = { inline_keyboard: [[{ text: "Approve ✅", callback_data: "task_app_" + submissionId, style: "success" }, { text: "Reject ❌", callback_data: "task_rej_" + submissionId, style: "danger" }]] };
    var sendOpts = { parse_mode: "HTML", reply_markup: kb };
    if (forwardedMsgId) sendOpts.reply_parameters = { message_id: forwardedMsgId };
    try { await ctx.api.sendMessage(alertChannel, caption, sendOpts).catch(() => { }); } catch (e) { }
  }
  return ctx.reply("Task Submitted!\n\nTask: " + task.title + "\nReward: " + RUPEE + task.reward + "\n\nWait for admin approval.", { parse_mode: "HTML", reply_markup: await buildKeyboardFromLayout(userId) }).catch(() => { });
});

bot.callbackQuery(/^do_task_/, async (ctx) => {
  var userId = ctx.from.id;
  var taskId = ctx.callbackQuery.data.replace("do_task_", "");
  var task = await Task.findOne({ taskId: taskId });
  if (!task) return ctx.answerCallbackQuery({ text: "Task not found", show_alert: true }).catch(() => { });
  if (task.completedUsers.indexOf(userId) >= 0) return ctx.answerCallbackQuery({ text: "You have already submitted this task!", show_alert: true }).catch(() => { });
  if (task.expiresAt && new Date(task.expiresAt) <= new Date()) { await ctx.answerCallbackQuery({ text: "Task expired", show_alert: true }).catch(() => { }); return ctx.editMessageText("<b>Task Expired</b>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "back_to_tasks", style: "primary" }]] } }).catch(() => { }); }
  await ctx.answerCallbackQuery().catch(() => { });
  var bodyText = "Task Name: " + task.title + "\nReward: " + RUPEE + task.reward + "\nLink: " + task.link;
  await ctx.editMessageText("<b>Task Details</b>\n\n<blockquote>" + bodyText + "</blockquote>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Task Link", url: task.link, style: "primary" }], [{ text: "Upload Screenshot", callback_data: "task_upload_" + taskId, style: "primary" }], [{ text: "Send Refer Link / Number", callback_data: "task_refer_" + taskId, style: "primary" }], [{ text: "Back", callback_data: "back_to_tasks", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("back_to_tasks", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  var tasks = await Task.find({ isActive: { $ne: false }, isComplete: true }).sort({ createdAt: -1 }).lean();
  if (!tasks || tasks.length === 0) return ctx.editMessageText("<b>Available Tasks</b>\n\nNo tasks available.", { parse_mode: "HTML" }).catch(() => { });
  var taskButtons = [];
  tasks.forEach(function(t) { taskButtons.push([{ text: t.title + " (" + RUPEE + t.reward + ")", callback_data: "do_task_" + t.taskId, style: "primary" }]); });
  taskButtons.push([{ text: "Back", callback_data: "back_to_balance", style: "primary" }]);
  return ctx.editMessageText("<b>Available Tasks</b>", { reply_markup: { inline_keyboard: taskButtons }, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery("canc_task", async (ctx) => {
  delete userState[ctx.from.id];
  ctx.answerCallbackQuery({ text: "Cancelled" }).catch(() => { });
  await ctx.editMessageText("Cancelled", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "back_to_balance", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery(/^task_upload_/, async (ctx) => {
  var userId = ctx.from.id;
  var taskId = ctx.callbackQuery.data.replace("task_upload_", "");
  var task = await Task.findOne({ taskId: taskId });
  if (!task) return ctx.answerCallbackQuery({ text: "Task not found", show_alert: true }).catch(() => { });
  if (task.completedUsers.indexOf(userId) >= 0) return ctx.answerCallbackQuery({ text: "Already submitted!", show_alert: true }).catch(() => { });
  await ctx.answerCallbackQuery().catch(() => { });
  userState[userId] = "WAITING_TASK_PHOTO_" + taskId;
  await ctx.editMessageText("<b>Upload Screenshot</b>\n\nSend your task completion screenshot:\n\nTask: " + task.title + "\nReward: " + RUPEE + task.reward, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "canc_task", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^task_refer_/, async (ctx) => {
  var userId = ctx.from.id;
  var taskId = ctx.callbackQuery.data.replace("task_refer_", "");
  var task = await Task.findOne({ taskId: taskId });
  if (!task) return ctx.answerCallbackQuery({ text: "Task not found", show_alert: true }).catch(() => { });
  if (task.completedUsers.indexOf(userId) >= 0) return ctx.answerCallbackQuery({ text: "Already submitted!", show_alert: true }).catch(() => { });
  await ctx.answerCallbackQuery().catch(() => { });
  userState[userId] = "TASK_REFER_" + taskId;
  await ctx.editMessageText("<b>Send Refer Link / Number</b>\n\nSend refer link OR your 10-digit number:\n\nExamples:\n• https://t.me/yourlink\n• 9876543210\n• (forwarded message)\n\nTask: " + task.title + "\nReward: " + RUPEE + task.reward, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "canc_task", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^task_app_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var subId = ctx.callbackQuery.data.replace("task_app_", "");
  var sub = await TaskSubmission.findOne({ submissionId: subId });
  if (!sub || sub.status !== "Pending") return ctx.answerCallbackQuery({ text: "Processed!", show_alert: true }).catch(() => { });
  sub.status = "Approved";
  await sub.save();
  var user = await getUser(sub.userId);
  user.balance += sub.reward;
  await user.save();
  await logBalanceHistory(sub.userId, "Task Approved (" + sub.taskTitle + ")", sub.reward);
  await Task.updateOne({ taskId: sub.taskId }, { $addToSet: { completedUsers: sub.userId } });
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Task Approved", sub.taskTitle, sub.reward, sub.userId);
  await ctx.answerCallbackQuery({ text: "Approved!" }).catch(() => { });
  var msg = ctx.callbackQuery.message;
  if (msg.photo) await ctx.editMessageCaption({ caption: (msg.caption || "") + "\n\nAPPROVED" }).catch(() => { });
  else await ctx.editMessageText((msg.text || "") + "\n\nAPPROVED").catch(() => { });
  try { await ctx.api.sendMessage(sub.userId, "<b>Task Approved!</b>\n\nTask: " + sub.taskTitle + "\nReward: " + RUPEE + sub.reward, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
});

bot.callbackQuery(/^task_rej_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var subId = ctx.callbackQuery.data.replace("task_rej_", "");
  var sub = await TaskSubmission.findOne({ submissionId: subId });
  if (!sub || sub.status !== "Pending") return ctx.answerCallbackQuery({ text: "Processed!", show_alert: true }).catch(() => { });
  sub.status = "Rejected";
  await sub.save();
  await ctx.answerCallbackQuery({ text: "Rejected!" }).catch(() => { });
  var msg = ctx.callbackQuery.message;
  if (msg.photo) await ctx.editMessageCaption({ caption: (msg.caption || "") + "\n\nREJECTED" }).catch(() => { });
  else await ctx.editMessageText((msg.text || "") + "\n\nREJECTED").catch(() => { });
  try { await ctx.api.sendMessage(sub.userId, "<b>Task Rejected</b>\n\nTask: " + sub.taskTitle + "\nReward: " + RUPEE + sub.reward, { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
});

bot.callbackQuery(/^upi_app_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var orderId = ctx.callbackQuery.data.replace("upi_app_", "");
  var payment = await UPIPayment.findOne({ orderId: orderId });
  if (!payment || payment.status === "Approved") return ctx.answerCallbackQuery({ text: "Already processed", show_alert: true }).catch(() => { });
  payment.status = "Approved";
  payment.verifiedAt = new Date();
  payment.approvedBy = ctx.from.first_name || "Admin";
  await payment.save();
  var user = await getUser(payment.userId);
  user.balance += payment.amount;
  await user.save();
  await logBalanceHistory(payment.userId, "UPI Deposit", payment.amount);
  await ctx.answerCallbackQuery({ text: "✅ Approved!" }).catch(() => { });
  try { await bot.api.sendMessage(payment.userId, "✅ Deposit Approved!\n\n💰 " + RUPEE + payment.amount.toFixed(2) + "\n🔐 UTR: <code>" + payment.utr + "</code>", { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
  await ctx.editMessageText("✅ <b>Approved</b> — " + RUPEE + payment.amount, { parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^upi_rej_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var orderId = ctx.callbackQuery.data.replace("upi_rej_", "");
  var payment = await UPIPayment.findOne({ orderId: orderId });
  if (!payment || payment.status === "Rejected") return ctx.answerCallbackQuery({ text: "Already processed", show_alert: true }).catch(() => { });
  payment.status = "Rejected";
  payment.approvedBy = ctx.from.first_name || "Admin";
  await payment.save();
  await ctx.answerCallbackQuery({ text: "❌ Rejected!" }).catch(() => { });
  try { await bot.api.sendMessage(payment.userId, "❌ Deposit Rejected\n\n💰 " + RUPEE + payment.amount.toFixed(2) + "\n🔐 UTR: <code>" + payment.utr + "</code>", { parse_mode: "HTML" }).catch(() => { }); } catch (e) { }
  await ctx.editMessageText("❌ <b>Rejected</b> — " + RUPEE + payment.amount, { parse_mode: "HTML" }).catch(() => { });
});

app.get("/receipt/:id", async (req, res) => {
  try {
    var wd = await Withdrawal.findOne({ withdrawalId: req.params.id });
    if (!wd) return res.status(404).send("<h2 style='color:white;background:#111;text-align:center;padding:50px;'>Receipt not found!</h2>");
    var ownerId = await getConfig("owner_id", MAIN_OWNER_ID);
    var ownerName = await getConfig("owner_display_name", null);
    var ownerLink = await getConfig("owner_display_link", null);
    if (!ownerName) {
      var ownerUser = await User.findOne({ userId: ownerId });
      ownerName = ownerUser ? (ownerUser.firstName || "Owner") : "Owner";
    }
    if (!ownerLink) ownerLink = ownerId.toString();
    var finalOwnerLink = convertOwnerLink(ownerLink);
    var isSuccess = wd.status === "Approved";
    var isFailed = wd.status === "Rejected" || wd.status === "Failed";
    var statusTitle = isSuccess ? "TRANSFER COMPLETE" : (isFailed ? "TRANSFER FAILED" : "TRANSFER PENDING");
    var statusSubtitle = isSuccess ? "FUNDS CREDITED" : (isFailed ? "TRANSACTION REJECTED" : "PROCESSING PAYMENT");
    var accentColor = isSuccess ? "#00ffcc" : (isFailed ? "#ff4d4d" : "#ffa500");
    var iconSvg = isSuccess ? "&#10003;" : (isFailed ? "&#10005;" : "&#8943;");
    var displayTxn = wd.txnNumber && wd.txnNumber !== "" ? wd.txnNumber : wd.withdrawalId;
    var gatewayDisplay = wd.gatewayName && wd.gatewayName !== "" ? wd.gatewayName : (wd.isGateway ? "GATEWAY" : "MANUAL");
    var approvedBy = wd.approvedBy && wd.approvedBy !== "" ? wd.approvedBy : "-";
    var safeAmount = wd.amount.toFixed(2);
    var safeDetails = escapeHtml(wd.details).replace(/'/g, "\\'");
    var safeTxn = escapeHtml(displayTxn).replace(/'/g, "\\'");
    var html = "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1.0\"><title>Receipt #" + escapeHtml(wd.withdrawalId) + "</title><style>body{background:#0b0e14;color:#fff;font-family:'Segoe UI',sans-serif;margin:0;padding:20px;display:flex;align-items:center;justify-content:center;min-height:100vh;}.container{background:#151a21;border-radius:20px;padding:30px;max-width:420px;width:100%;text-align:center;border:1px solid #222c37;}.icon-box{width:70px;height:70px;background:rgba(0,255,204,0.1);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:32px;color:" + accentColor + ";border:2px solid " + accentColor + ";}.title{font-size:20px;font-weight:bold;color:" + accentColor + ";letter-spacing:1px;}.subtitle{font-size:12px;color:#8a9ba8;margin:5px 0 25px;}.card-box{background:#1e2530;border-radius:15px;padding:20px;margin-bottom:20px;}.amount-label{font-size:11px;color:#8a9ba8;text-transform:uppercase;}.amount-val{font-size:32px;font-weight:bold;margin-top:8px;cursor:pointer;user-select:all;}.info-row{background:#151a21;border-radius:10px;padding:12px 15px;margin-top:10px;display:flex;justify-content:space-between;font-size:13px;gap:10px;}.info-title{color:#8a9ba8;flex-shrink:0;}.info-value{color:#fff;font-weight:500;text-align:right;word-break:break-all;cursor:pointer;user-select:all;}.info-value.mono{font-family:'Courier New',monospace;color:#00ffcc;font-size:12px;}.status-badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:600;margin-top:5px;}.status-pending{background:rgba(255,165,0,0.15);color:#ffa500;border:1px solid #ffa500;}.status-approved{background:rgba(0,255,204,0.15);color:#00ffcc;border:1px solid #00ffcc;}.status-rejected,.status-failed{background:rgba(255,77,77,0.15);color:#ff4d4d;border:1px solid #ff4d4d;}.close-btn{background:#2a3443;color:#fff;border:none;width:100%;padding:14px;border-radius:12px;font-size:14px;font-weight:bold;cursor:pointer;margin-top:15px;}.provider-footer{margin-top:22px;padding-top:18px;border-top:1px solid #222c37;text-align:center;}.provider-text{font-size:13px;color:#8a9ba8;}.provider-name{color:#00ffcc;font-weight:700;text-decoration:none;border-bottom:1px dashed #00ffcc;padding-bottom:2px;}</style></head><body><div class=\"container\"><div class=\"icon-box\">" + iconSvg + "</div><div class=\"title\">" + statusTitle + "</div><div class=\"subtitle\">" + statusSubtitle + "</div><div class=\"card-box\"><div class=\"amount-label\">WITHDRAWAL AMOUNT</div><div class=\"amount-val\" data-copy=\"" + safeAmount + "\">₹ " + safeAmount + "</div></div><div class=\"info-row\"><span class=\"info-title\">METHOD</span><span class=\"info-value\">" + escapeHtml(wd.method.toUpperCase()) + "</span></div><div class=\"info-row\"><span class=\"info-title\">DESTINATION</span><span class=\"info-value\" data-copy=\"" + safeDetails + "\">" + escapeHtml(wd.details) + "</span></div><div class=\"info-row\"><span class=\"info-title\">TXN ID</span><span class=\"info-value mono\" data-copy=\"" + safeTxn + "\">" + escapeHtml(displayTxn) + "</span></div><div class=\"info-row\"><span class=\"info-title\">REF NO</span><span class=\"info-value mono\">TXN" + escapeHtml(wd.withdrawalId) + "</span></div><div class=\"info-row\"><span class=\"info-title\">GATEWAY</span><span class=\"info-value\">" + escapeHtml(gatewayDisplay) + "</span></div><div class=\"info-row\"><span class=\"info-title\">APPROVED BY</span><span class=\"info-value\">" + escapeHtml(approvedBy) + "</span></div><div style=\"margin-top:15px;\"><span class=\"status-badge status-" + wd.status.toLowerCase() + "\">" + wd.status.toUpperCase() + "</span></div><button class=\"close-btn\" onclick=\"window.close()\">CLOSE & RETURN</button><div class=\"provider-footer\"><div class=\"provider-text\">Provided by <a href=\"" + finalOwnerLink + "\" class=\"provider-name\" target=\"_blank\">" + escapeHtml(ownerName) + "</a></div></div></div><script>document.querySelectorAll('[data-copy]').forEach(el => { el.addEventListener('click', () => { navigator.clipboard.writeText(el.dataset.copy).then(() => { let t = document.createElement('div'); t.textContent = '✅ Copied!'; t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#00ffcc;color:#000;padding:10px 20px;border-radius:10px;font-weight:bold;z-index:9999;'; document.body.appendChild(t); setTimeout(() => t.remove(), 1500); }); }); });</script></body></html>";
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
    var uid = parseInt(req.params.userId, 10);
    var user = await User.findOne({ userId: uid }).lean();
    if (!user) return res.json({ success: false, error: "User not found" });
    res.json({ success: true, user: user });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/config", async (req, res) => {
  try {
    var config = { appLogo: await getConfig("app_logo", "Task Earn Bot"), botUsername: await getConfig("bot_username", ""), minWithdraw: await getConfig("min_withdraw", 10), maxWithdraw: await getConfig("max_withdraw", 10000), supportUsername: await getConfig("support_username", "Not Set"), ownerId: await getConfig("owner_id", MAIN_OWNER_ID) };
    res.json({ success: true, config: config });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/tasks", async (req, res) => {
  try { var tasks = await Task.find({ isActive: { $ne: false }, isComplete: true }).lean(); res.json({ success: true, tasks: tasks }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get("/miniapp/api/is-admin/:userId", async (req, res) => {
  try { var uid = parseInt(req.params.userId, 10); res.json({ success: true, isAdmin: await isAdmin(uid), isOwner: await isOwner(uid) }); }
  catch (e) { res.json({ success: false, isAdmin: false }); }
});

bot.catch((err) => console.error("Bot Error:", err.message));

var botRetryCount = 0;
var MAX_BOT_RETRIES = 15;

async function startBotSafe() {
  try {
    await bot.start({ onStart: function(info) { console.log("Bot @" + info.username + " running!"); botRetryCount = 0; } });
  } catch (err) {
    var errMsg = err && err.message ? err.message : String(err);
    console.error("Bot start error:", errMsg);
    if (errMsg.indexOf("409") >= 0 || errMsg.indexOf("Conflict") >= 0) {
      botRetryCount++;
      if (botRetryCount <= MAX_BOT_RETRIES) {
        console.log("409 Conflict. Retry " + botRetryCount + "/" + MAX_BOT_RETRIES + " in 5s...");
        await new Promise(function(r) { setTimeout(r, 5000); });
        return startBotSafe();
      }
    }
    console.error("Bot failed after max retries.");
    process.exit(1);
  }
}

process.on("unhandledRejection", function(reason) { console.error("Unhandled Rejection:", reason); });
process.on("uncaughtException", function(err) { console.error("Uncaught Exception:", err.message); });

mongoose.connect(MONGO_URI).then(async function() {
  console.log("MongoDB Connected!");
  try {
    await User.collection.createIndex({ userId: 1 }, { unique: true });
    await User.collection.createIndex({ balance: -1 });
    await Withdrawal.collection.createIndex({ userId: 1, status: 1 });
    await BalanceHistory.collection.createIndex({ userId: 1, createdAt: -1 });
    await Config.collection.createIndex({ key: 1 }, { unique: true });
    await Channel.collection.createIndex({ channelId: 1 }, { unique: true });
    await AutoUpi.collection.createIndex({ gatewayId: 1 }, { unique: true });
    await AutoBank.collection.createIndex({ gatewayId: 1 }, { unique: true });
    console.log("MongoDB indexes created!");
  } catch (e) { console.log("Index creation:", e.message); }
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
  await getConfig("unknown_command_text", "I didn't understand that.\n\nPlease /start the bot again.");
  await getConfig("bot_font", "normal");
  await getConfig("deposit_enabled", false);
  await getConfig("deposit_message", "Deposit is currently unavailable. Please contact support.");
  var savedLayoutVersion = await getConfig("layout_version", "v1");
  if (savedLayoutVersion !== CURRENT_LAYOUT_VERSION) {
    console.log("Layout version changed (" + savedLayoutVersion + " -> " + CURRENT_LAYOUT_VERSION + "), resetting...");
    await setConfig("admin_panel_layout", DEFAULT_ADMIN_PANEL_LAYOUT);
    await setConfig("keyboard_layout", DEFAULT_KEYBOARD_LAYOUT);
    await setConfig("layout_version", CURRENT_LAYOUT_VERSION);
  }
  var fund = await LiveFund.findOne({ key: "main_fund" });
  if (!fund) await LiveFund.create({ key: "main_fund" });
  var wsCount = await WithdrawSettings.countDocuments({});
  if (wsCount === 0) {
    var defaults = [
      { method: "upi", isActive: true, minAmount: 0, maxAmount: 0, taxPercent: 0, taxSlabs: [] },
      { method: "bank", isActive: true, minAmount: 0, maxAmount: 0, taxPercent: 0, taxSlabs: [] },
      { method: "amazon", isActive: false, minAmount: 0, maxAmount: 0, taxPercent: 0, taxSlabs: [] },
      { method: "redeem", isActive: false, minAmount: 0, maxAmount: 0, taxPercent: 0, taxSlabs: [] }
    ];
    for (var di = 0; di < defaults.length; di++) await WithdrawSettings.create(defaults[di]);
  }
  setInterval(async function() {
    try {
      var now = new Date();
      var expiredTasks = await Task.find({ expiresAt: { $ne: null, $lte: now }, isComplete: true });
      for (var ti = 0; ti < expiredTasks.length; ti++) { await Task.deleteOne({ taskId: expiredTasks[ti].taskId }); }
    } catch (e) { }
  }, 60 * 1000);
  console.log("Waiting 8s for cleanup...");
  await new Promise(function(r) { setTimeout(r, 8000); });
  console.log("Server ready");
  await startBotSafe();
}).catch(function(err) { console.error("DB Error:", err); process.exit(1); });

var server = app.listen(PORT, "0.0.0.0", function() { console.log("Server running on port " + PORT); });
server.on("error", function(err) {
  if (err.code === "EADDRINUSE") {
    console.error("Port " + PORT + " in use. Retrying...");
    setTimeout(function() { server.close(); server.listen(PORT, "0.0.0.0"); }, 2000);
  }
});

process.on("SIGTERM", function() { server.close(function() { process.exit(0); }); });
process.on("SIGINT", function() { server.close(function() { process.exit(0); }); });

setInterval(function() {
  var renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderUrl) fetch(renderUrl).catch(function() { });
}, 300000);

setInterval(function() {
  if (global.quickPayCache) { for (var uid in global.quickPayCache) delete global.quickPayCache[uid]; }
  if (global.broadcastCache) { for (var uid2 in global.broadcastCache) delete global.broadcastCache[uid2]; }
  if (global.taskCreation) { for (var uid3 in global.taskCreation) delete global.taskCreation[uid3]; }
}, 30 * 60 * 1000);
