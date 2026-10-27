export const PRACTICE_TIME_ZONE = "America/New_York";

export const instructorAccount = {
  id: "user_anson",
  email: "anson@example.com",
  displayName: "Anson Ainsworth",
  roles: ["instructor", "admin"] as const,
};

export const parentAccount = {
  id: "user_henry_family",
  email: "henry.family@example.com",
  displayName: "Henry's family",
  roles: ["parent"] as const,
};

export const henryFamily = {
  id: "family_henry",
  name: "Henry's family",
  phone: "+15555501098",
  lessonsRemaining: 8,
  childId: "child_henry",
  childFirstName: "Henry",
  address: "100 Sample Court, Jupiter, FL 33458",
  lat: 26.9342,
  lng: -80.0942,
};

export const previewAccounts = [
  { label: "Anson", email: instructorAccount.email },
  { label: "Henry's family", email: parentAccount.email },
] as const;
