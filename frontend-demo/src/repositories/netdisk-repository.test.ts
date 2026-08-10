import { describe, expect, it } from "vitest";
import { demoRepository } from "./demo-repository";

describe("netdisk repository boundary", () => {
  it("exposes source status, discovered files, field mapping, and sync jobs", async () => {
    const status = await demoRepository.getBaiduNetdiskStatus();
    const files = await demoRepository.listBaiduNetdiskFiles({ kind: "financial_workbook" });
    const catalog = await demoRepository.getBaiduNetdiskFieldCatalog(files[0].id);
    const sync = await demoRepository.createBaiduNetdiskSync({ path: "/greenwashing", inspectSchemas: true });

    expect(status).toMatchObject({ provider: "baidu_netdisk", connectionStatus: "connected", schemaPendingFileCount: 1 });
    expect(files).toHaveLength(1);
    expect(catalog.fields).toContainEqual(expect.objectContaining({ sourceField: "F011201A", targetField: "assetLiabilityRatio", status: "mapped" }));
    await expect(demoRepository.getBaiduNetdiskSyncJob(sync.jobId)).resolves.toMatchObject({ status: "queued", phase: "discover" });
  });
});
