import type { Alloma } from "../../shared/types.js";

/** Ma'lumot fayllarida yoziladigan yozuv: id, slug va era avtomatik qo'shiladi. */
export type AllomaSeed = Omit<Alloma, "id" | "slug" | "era" | "yearsApproximate" | "image"> & {
  yearsApproximate?: boolean;
};

/** Repository qabul qiladigan yozuv (era bilan). Rasm alohida manifestdan qo'shiladi. */
export type AllomaInput = Omit<Alloma, "id" | "slug" | "yearsApproximate" | "image"> & {
  yearsApproximate?: boolean;
};
