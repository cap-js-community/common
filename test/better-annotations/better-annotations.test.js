"use strict";

const cds = require("@sap/cds");

process.env.PORT = 0;

cds.env.betterAnnotations = true;
cds.env.requires ??= {};
cds.env.requires.auth = {
  kind: "mocked",
  users: {
    admin: { roles: ["Admin", "authenticated-user"] },
    manager: { roles: ["Manager", "authenticated-user"] },
    employee: { roles: ["Employee", "authenticated-user"] },
    nobody: { roles: ["authenticated-user"] },
  },
};

const { GET } = cds.test(__dirname);

const SERVICE_PATH = "/odata/v4/test-better-annotations";

describe("Better Annotations", () => {
  describe("$metadata", () => {
    it("contains BetterAnnotationsConfig singleton entity", async () => {
      const { data } = await GET(`${SERVICE_PATH}/$metadata?$format=json`, {
        auth: { username: "admin", password: "admin" },
      });
      const raw = JSON.stringify(data);
      expect(raw).toContain("BetterAnnotationsConfig");
    });

    it("Orders has static CreateHidden (no CREATE grant)", async () => {
      const { data } = await GET(`${SERVICE_PATH}/$metadata?$format=json`, {
        auth: { username: "admin", password: "admin" },
      });
      const raw = JSON.stringify(data);
      // CreateHidden and InsertRestrictions should be present for Orders
      expect(raw).toContain("CreateHidden");
      expect(raw).toContain("InsertRestrictions");
    });

    it("Products references singleton for CreateHidden", async () => {
      const { data } = await GET(`${SERVICE_PATH}/$metadata?$format=json`, {
        auth: { username: "admin", password: "admin" },
      });
      const raw = JSON.stringify(data);
      expect(raw).toContain("BetterAnnotationsConfig/canCreate_Products");
    });

    it("Reviews has __fc_canUpdate virtual property", async () => {
      const { data } = await GET(`${SERVICE_PATH}/$metadata?$format=json`, {
        auth: { username: "admin", password: "admin" },
      });
      const raw = JSON.stringify(data);
      expect(raw).toContain("__fc_canUpdate");
      expect(raw).toContain("__fc_canDelete");
    });

    it("NoUIEntity has no generated __fc_ fields", async () => {
      const { data } = await GET(`${SERVICE_PATH}/$metadata?$format=json`, {
        auth: { username: "admin", password: "admin" },
      });
      const noUiType = data?.TestBetterAnnotationsService?.NoUIEntity;
      expect(noUiType).toBeDefined();
      const fcFields = Object.keys(noUiType).filter((k) => k.startsWith("__fc_"));
      expect(fcFields).toEqual([]);
    });
  });

  describe("BetterAnnotationsConfig singleton", () => {
    it("admin gets canCreate_Products = true", async () => {
      const { data } = await GET(`${SERVICE_PATH}/BetterAnnotationsConfig`, {
        auth: { username: "admin", password: "admin" },
      });
      expect(data.canCreate_Products).toBe(true);
      expect(data.canUpdate_Products).toBe(true);
      expect(data.canDelete_Products).toBe(true);
    });

    it("employee gets canCreate_Products = false", async () => {
      const { data } = await GET(`${SERVICE_PATH}/BetterAnnotationsConfig`, {
        auth: { username: "employee", password: "employee" },
      });
      expect(data.canCreate_Products).toBe(false);
      expect(data.canUpdate_Products).toBe(false);
      expect(data.canDelete_Products).toBe(false);
    });

    it("manager gets canCreate_Products = true", async () => {
      const { data } = await GET(`${SERVICE_PATH}/BetterAnnotationsConfig`, {
        auth: { username: "manager", password: "manager" },
      });
      expect(data.canCreate_Products).toBe(true);
      expect(data.canUpdate_Products).toBe(true);
      expect(data.canDelete_Products).toBe(true);
    });

    it("admin gets canUpdate_Orders = true, employee = false", async () => {
      const { data: adminData } = await GET(`${SERVICE_PATH}/BetterAnnotationsConfig`, {
        auth: { username: "admin", password: "admin" },
      });
      expect(adminData.canUpdate_Orders).toBe(true);

      const { data: empData } = await GET(`${SERVICE_PATH}/BetterAnnotationsConfig`, {
        auth: { username: "employee", password: "employee" },
      });
      expect(empData.canUpdate_Orders).toBe(false);
    });

    it("singleton property accessible via /BetterAnnotationsConfig/canDelete_Products", async () => {
      const { data } = await GET(`${SERVICE_PATH}/BetterAnnotationsConfig/canDelete_Products`, {
        auth: { username: "admin", password: "admin" },
      });
      expect(data.value).toBe(true);
    });

    it("singleton supports $select", async () => {
      const { data } = await GET(
        `${SERVICE_PATH}/BetterAnnotationsConfig?$select=canCreate_Products,canDelete_Products`,
        {
          auth: { username: "employee", password: "employee" },
        },
      );
      expect(data.canCreate_Products).toBe(false);
      expect(data.canDelete_Products).toBe(false);
    });
  });

  describe("Virtual field computation (__fc_)", () => {
    it("Reviews: admin gets __fc_canUpdate = true (unconditional)", async () => {
      const { data } = await GET(`${SERVICE_PATH}/Reviews`, {
        auth: { username: "admin", password: "admin" },
      });
      expect(data.value.length).toBeGreaterThan(0);
      for (const item of data.value) {
        expect(item.__fc_canUpdate).toBe(true);
        expect(item.__fc_canDelete).toBe(true);
      }
    });

    it("Reviews: employee gets __fc_canUpdate based on createdBy", async () => {
      const { data } = await GET(`${SERVICE_PATH}/Reviews`, {
        auth: { username: "employee", password: "employee" },
      });
      expect(data.value.length).toBeGreaterThan(0);
      for (const item of data.value) {
        if (item.createdBy === "employee") {
          expect(item.__fc_canUpdate).toBe(true);
          expect(item.__fc_canDelete).toBe(true);
        } else {
          expect(item.__fc_canUpdate).toBe(false);
          expect(item.__fc_canDelete).toBe(false);
        }
      }
    });

    it("Tickets: admin gets __fc_can_reject based on assignedTo", async () => {
      const { data } = await GET(`${SERVICE_PATH}/Tickets`, {
        auth: { username: "admin", password: "admin" },
      });
      expect(data.value.length).toBeGreaterThan(0);
      for (const item of data.value) {
        // Admin has unconditional * grant → __fc_can_reject always true
        expect(item.__fc_can_reject).toBe(true);
      }
    });
  });

  describe("@Core.OperationAvailable", () => {
    it("metadata contains OperationAvailable for Tickets actions", async () => {
      const { data } = await GET(`${SERVICE_PATH}/$metadata?$format=json`, {
        auth: { username: "admin", password: "admin" },
      });
      const raw = JSON.stringify(data);
      expect(raw).toContain("OperationAvailable");
      // approve action should reference singleton (Manager role only, no where)
      expect(raw).toContain("can_Tickets_approve");
      // reject action should reference virtual field (has where clause)
      expect(raw).toContain("__fc_can_reject");
    });

    it("escalate action (not in @restrict) gets OperationAvailable via wildcard", async () => {
      const { data } = await GET(`${SERVICE_PATH}/$metadata?$format=json`, {
        auth: { username: "admin", password: "admin" },
      });
      const raw = JSON.stringify(data);
      // escalate is not in any grant, but Admin has '*' → singleton field generated
      expect(raw).toContain("can_Tickets_escalate");
    });

    it("Fiori Books app exposes bound publish action with OperationAvailable", async () => {
      const { data } = await GET(`${SERVICE_PATH}/$metadata?$format=json`, {
        auth: { username: "admin", password: "admin" },
      });
      const raw = JSON.stringify(data);
      expect(raw).toContain("publish");
      expect(raw).toContain("__fc_can_publish");
      expect(raw).toContain("OperationAvailable");
    });

    it("Books bound publish action availability is computed per instance", async () => {
      const { data } = await GET(`${SERVICE_PATH}/Books`, {
        auth: { username: "employee", password: "employee" },
      });
      expect(data.value.length).toBeGreaterThan(0);
      for (const item of data.value) {
        if (item.createdBy === "employee") {
          expect(item.__fc_can_publish).toBe(true);
        } else {
          expect(item.__fc_can_publish).toBe(false);
        }
      }
    });

    it("singleton exposes can_Tickets_approve for manager", async () => {
      const { data } = await GET(`${SERVICE_PATH}/BetterAnnotationsConfig`, {
        auth: { username: "manager", password: "manager" },
      });
      // Manager has approve grant
      expect(data.can_Tickets_approve).toBe(true);
    });

    it("singleton exposes can_Tickets_approve = false for employee", async () => {
      const { data } = await GET(`${SERVICE_PATH}/BetterAnnotationsConfig`, {
        auth: { username: "employee", password: "employee" },
      });
      expect(data.can_Tickets_approve).toBe(false);
    });
  });

  describe("Composition parent-path where clause (Books → Pages)", () => {
    it("Pages has __fc_canCreate virtual field in metadata", async () => {
      const { data } = await GET(`${SERVICE_PATH}/$metadata?$format=json`, {
        auth: { username: "admin", password: "admin" },
      });
      const raw = JSON.stringify(data);
      expect(raw).toContain("__fc_canCreate");
    });

    it("Books metadata has Fiori annotations + generated hidden annotations", async () => {
      const { data } = await GET(`${SERVICE_PATH}/$metadata?$format=json`, {
        auth: { username: "admin", password: "admin" },
      });
      const raw = JSON.stringify(data);
      // Fiori annotations from app/books/annotations.cds
      expect(raw).toContain("HeaderInfo");
      expect(raw).toContain("SelectionFields");
      // Generated: Books has virtual __fc_ for UPDATE/DELETE (employee where clause)
      expect(raw).toContain("__fc_canUpdate");
      expect(raw).toContain("__fc_canDelete");
      // Generated: Pages has NavigationRestrictions or similar
      expect(raw).toContain("UpdateHidden");
      expect(raw).toContain("DeleteHidden");
    });

    it("Pages: admin gets __fc_canCreate = true (unconditional *)", async () => {
      const { data } = await GET(`${SERVICE_PATH}/Pages`, {
        auth: { username: "admin", password: "admin" },
      });
      expect(data.value.length).toBeGreaterThan(0);
      for (const item of data.value) {
        expect(item.__fc_canCreate).toBe(true);
        expect(item.__fc_canUpdate).toBe(true);
        expect(item.__fc_canDelete).toBe(true);
      }
    });

    it("Pages: employee gets __fc_canCreate based on parent book.createdBy", async () => {
      const { data } = await GET(`${SERVICE_PATH}/Pages`, {
        auth: { username: "employee", password: "employee" },
      });
      expect(data.value.length).toBeGreaterThan(0);
      for (const item of data.value) {
        // Pages with book_ID=2 belong to book created by 'employee'
        if (item.book_ID === "2") {
          expect(item.__fc_canCreate).toBe(true);
          expect(item.__fc_canUpdate).toBe(true);
          expect(item.__fc_canDelete).toBe(true);
        } else {
          // Other books not owned by employee
          expect(item.__fc_canCreate).toBe(false);
          expect(item.__fc_canUpdate).toBe(false);
          expect(item.__fc_canDelete).toBe(false);
        }
      }
    });
  });

  describe("Exists clause (best-effort fallback)", () => {
    it("Projects: __fc_canUpdate virtual field is generated in metadata", async () => {
      const { data } = await GET(`${SERVICE_PATH}/$metadata?$format=json`, {
        auth: { username: "admin", password: "admin" },
      });
      const raw = JSON.stringify(data);
      // Projects entity should have __fc_canUpdate because employee grant has where clause
      const projectsType = data?.TestBetterAnnotationsService?.Projects;
      expect(projectsType).toBeDefined();
      expect(projectsType.__fc_canUpdate).toBeDefined();
      // UpdateHidden annotation should be present
      expect(raw).toContain("UpdateHidden");
    });

    it("Projects: admin gets __fc_canUpdate = true (unconditional *)", async () => {
      const { data } = await GET(`${SERVICE_PATH}/Projects`, {
        auth: { username: "admin", password: "admin" },
      });
      expect(data.value.length).toBeGreaterThan(0);
      for (const item of data.value) {
        expect(item.__fc_canUpdate).toBe(true);
      }
    });

    it("Projects: employee gets __fc_canUpdate = true (best-effort role match, exists unsupported)", async () => {
      const { data } = await GET(`${SERVICE_PATH}/Projects`, {
        auth: { username: "employee", password: "employee" },
      });
      expect(data.value.length).toBeGreaterThan(0);
      for (const item of data.value) {
        // Exists clause cannot be translated to CQL; role match → best-effort true
        expect(item.__fc_canUpdate).toBe(true);
      }
    });
  });
});
