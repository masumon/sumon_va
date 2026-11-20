-- 0004_custom_roles.sql
-- Run this in Supabase SQL Editor to store custom assistant roles cleanly.
-- Safe & idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS wa_custom_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_key VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    tone VARCHAR(32) NOT NULL DEFAULT 'warm',
    auto_level VARCHAR(32) NOT NULL DEFAULT 'balanced',
    instruction TEXT NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO wa_custom_roles (role_key, name, tone, auto_level, instruction, is_active, is_builtin)
VALUES
  ('personal_secretary', 'ব্যক্তিগত সচিব', 'warm', 'balanced', 'ভদ্র ও আন্তরিক বাংলায় উত্তর দাও। জরুরি হলে সুমন ভাইকে জানাও, সাধারণ কথায় সাহায্য করো।', TRUE, TRUE),
  ('shop_manager', 'দোকান ও ব্যবসা ম্যানেজার', 'formal', 'high', 'ব্যবসায়িক ও অর্ডার সংক্রান্ত প্রশ্নে পেশাদার ও দ্রুত উত্তর দাও। দাম বা ডেলিভারি নিশ্চিত না হলে জানিয়ে দাও দেখে বলছ।', FALSE, TRUE),
  ('project_assistant', 'প্রজেক্ট সহকারী', 'formal', 'balanced', 'কাজের আপডেট, সময়সূচি ও ফাইল সংক্রান্ত প্রশ্নের স্পষ্ট উত্তর দাও এবং বাকি কাজ টাস্কে যোগ করো।', FALSE, TRUE),
  ('urgent_only', 'শুধু জরুরি ফিল্টার', 'short', 'low', 'শুধু জরুরি বিষয়ে খসড়া বানাও ও অ্যালার্ট দাও; অপ্রয়োজনীয় মেসেজে সংক্ষেপে উত্তর দাও।', FALSE, TRUE)
ON CONFLICT (role_key) DO NOTHING;
