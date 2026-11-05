/** O'zbekiston viloyatlari (ob-havo uchun markaz shahar koordinatalari). Bot va Mini App uchun umumiy. */
export interface Region {
  id: string;
  /** Viloyat nomi (tanlash ro'yxatida). */
  name: string;
  /** Markaz shahar (ob-havo shu yerniki). */
  city: string;
  latitude: number;
  longitude: number;
}

export const REGIONS: readonly Region[] = [
  { id: "toshkent-sh", name: "Toshkent shahri", city: "Toshkent", latitude: 41.2995, longitude: 69.2401 },
  { id: "toshkent", name: "Toshkent viloyati", city: "Nurafshon", latitude: 41.0167, longitude: 69.35 },
  { id: "andijon", name: "Andijon", city: "Andijon", latitude: 40.7821, longitude: 72.3442 },
  { id: "buxoro", name: "Buxoro", city: "Buxoro", latitude: 39.7747, longitude: 64.4286 },
  { id: "fargona", name: "Farg'ona", city: "Farg'ona", latitude: 40.3864, longitude: 71.7864 },
  { id: "jizzax", name: "Jizzax", city: "Jizzax", latitude: 40.1158, longitude: 67.8422 },
  { id: "xorazm", name: "Xorazm", city: "Urganch", latitude: 41.55, longitude: 60.6333 },
  { id: "namangan", name: "Namangan", city: "Namangan", latitude: 40.9983, longitude: 71.6726 },
  { id: "navoiy", name: "Navoiy", city: "Navoiy", latitude: 40.0844, longitude: 65.3792 },
  { id: "qashqadaryo", name: "Qashqadaryo", city: "Qarshi", latitude: 38.8606, longitude: 65.7891 },
  { id: "samarqand", name: "Samarqand", city: "Samarqand", latitude: 39.6542, longitude: 66.9597 },
  { id: "sirdaryo", name: "Sirdaryo", city: "Guliston", latitude: 40.4897, longitude: 68.7842 },
  { id: "surxondaryo", name: "Surxondaryo", city: "Termiz", latitude: 37.2242, longitude: 67.2783 },
  { id: "qoraqalpogiston", name: "Qoraqalpog'iston", city: "Nukus", latitude: 42.4531, longitude: 59.6103 },
];

export function findRegion(id: string): Region | undefined {
  return REGIONS.find((r) => r.id === id);
}
