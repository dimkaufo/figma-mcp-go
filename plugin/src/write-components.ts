import { makeSolidPaint } from "./write-helpers";

async function recolorTreeWalk(
  node: any,
  paint: SolidPaint,
  target: "fill" | "stroke" | "both",
  maxDepth: number,
  depth: number,
  counters: { fill: number; stroke: number; visited: number; skipped: number },
): Promise<void> {
  if (depth > maxDepth) return;
  counters.visited += 1;
  if (target === "fill" || target === "both") {
    if ("fills" in node) {
      const cur = node.fills;
      if (Array.isArray(cur) && cur.length > 0) {
        const next = cur.map((f: Paint) => (f && (f as any).type === "SOLID" ? paint : f));
        node.fills = next;
        counters.fill += 1;
      }
    }
  }
  if (target === "stroke" || target === "both") {
    if ("strokes" in node) {
      const cur = node.strokes;
      if (Array.isArray(cur) && cur.length > 0) {
        const next = cur.map((s: Paint) => (s && (s as any).type === "SOLID" ? paint : s));
        node.strokes = next;
        counters.stroke += 1;
      }
    }
  }
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      await recolorTreeWalk(child, paint, target, maxDepth, depth + 1, counters);
    }
  }
}

export const handleWriteComponentRequest = async (request: any) => {
  switch (request.type) {
    case "recolor_node_tree": {
      const p = request.params || {};
      const nodeId = request.nodeIds && request.nodeIds[0];
      if (!nodeId) throw new Error("nodeId is required");
      const color = p.color;
      if (typeof color !== "string" || !color) throw new Error("color is required (hex)");
      const target = (p.target || "both") as "fill" | "stroke" | "both";
      if (target !== "fill" && target !== "stroke" && target !== "both") {
        throw new Error(`target must be fill | stroke | both, got: ${target}`);
      }
      const includeRoot = p.includeRoot === undefined ? true : !!p.includeRoot;
      const maxDepth = typeof p.maxDepth === "number" && p.maxDepth > 0 ? Math.floor(p.maxDepth) : 50;
      const root = await figma.getNodeByIdAsync(nodeId) as any;
      if (!root) throw new Error(`Node not found: ${nodeId}`);
      const paint = makeSolidPaint(color);
      const counters = { fill: 0, stroke: 0, visited: 0, skipped: 0 };
      if (includeRoot) {
        await recolorTreeWalk(root, paint, target, maxDepth, 0, counters);
      } else if ("children" in root && Array.isArray((root as any).children)) {
        for (const child of (root as any).children) {
          await recolorTreeWalk(child, paint, target, maxDepth, 0, counters);
        }
      }
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: root.id, name: root.name, color, target, ...counters },
      };
    }

    case "swap_component": {
      const p = request.params || {};
      const nodeId = request.nodeIds && request.nodeIds[0];
      if (!nodeId) throw new Error("nodeId is required");
      if (!p.componentId) throw new Error("componentId is required");
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      if (node.type !== "INSTANCE") throw new Error(`Node ${nodeId} is not a component INSTANCE`);
      const component = await figma.getNodeByIdAsync(p.componentId);
      if (!component) throw new Error(`Component not found: ${p.componentId}`);
      if (component.type !== "COMPONENT") throw new Error(`Node ${p.componentId} is not a COMPONENT`);
      node.mainComponent = component;
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: node.id, name: node.name, componentId: component.id, componentName: component.name },
      };
    }

    case "detach_instance": {
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      const results: any[] = [];
      for (const nid of nodeIds) {
        const n = await figma.getNodeByIdAsync(nid);
        if (!n) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        if (n.type !== "INSTANCE") { results.push({ nodeId: nid, error: "Node is not an INSTANCE" }); continue; }
        const frame = n.detachInstance();
        results.push({ nodeId: nid, newId: frame.id, name: frame.name });
      }
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { results },
      };
    }

    case "delete_nodes": {
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      const results: any[] = [];
      for (const nid of nodeIds) {
        const n = await figma.getNodeByIdAsync(nid);
        if (!n) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        n.remove();
        results.push({ nodeId: nid, deleted: true });
      }
      figma.commitUndo();
      return { type: request.type, requestId: request.requestId, data: { results } };
    }

    case "navigate_to_page": {
      const p = request.params || {};
      let page: PageNode | undefined;
      if (p.pageId) {
        const found = await figma.getNodeByIdAsync(p.pageId);
        if (!found) throw new Error(`Page not found: ${p.pageId}`);
        if (found.type !== "PAGE") throw new Error(`Node ${p.pageId} is not a PAGE`);
        page = found as PageNode;
      } else if (p.pageName) {
        page = figma.root.children.find(pg => pg.name === p.pageName) as PageNode | undefined;
        if (!page) throw new Error(`Page not found with name: ${p.pageName}`);
      } else {
        throw new Error("pageId or pageName is required");
      }
      await figma.setCurrentPageAsync(page);
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: page.id, name: page.name },
      };
    }

    case "group_nodes": {
      const p = request.params || {};
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      const nodes = await Promise.all(nodeIds.map((id: string) => figma.getNodeByIdAsync(id)));
      const validNodes = nodes.filter((n): n is SceneNode => n !== null && n.type !== "DOCUMENT" && n.type !== "PAGE");
      if (validNodes.length === 0) throw new Error("No valid scene nodes found");
      const parent = validNodes[0].parent;
      if (!parent) throw new Error("Nodes must have a parent");
      const group = figma.group(validNodes, parent as any);
      if (p.name) group.name = p.name;
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: group.id, name: group.name, type: group.type },
      };
    }

    case "ungroup_nodes": {
      const nodeIds = request.nodeIds || [];
      if (nodeIds.length === 0) throw new Error("nodeIds is required");
      const results: any[] = [];
      for (const nid of nodeIds) {
        const n = await figma.getNodeByIdAsync(nid);
        if (!n) { results.push({ nodeId: nid, error: "Node not found" }); continue; }
        if (n.type !== "GROUP") { results.push({ nodeId: nid, error: "Node is not a GROUP" }); continue; }
        const group = n as GroupNode;
        const parent = group.parent as any;
        const index = parent.children.indexOf(group);
        const childIds: string[] = [];
        for (const child of [...group.children]) {
          parent.insertChild(index, child as SceneNode);
          childIds.push(child.id);
        }
        group.remove();
        results.push({ nodeId: nid, childIds });
      }
      figma.commitUndo();
      return { type: request.type, requestId: request.requestId, data: { results } };
    }

    case "add_component_property": {
      const p = request.params || {};
      const nodeId = request.nodeIds && request.nodeIds[0];
      if (!nodeId) throw new Error("nodeId is required");
      const node = await figma.getNodeByIdAsync(nodeId) as any;
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
        throw new Error(`Node ${nodeId} is not a COMPONENT or COMPONENT_SET`);
      }
      const name = p.name;
      const type = p.propertyType;
      if (!name) throw new Error("name is required");
      if (type !== "BOOLEAN" && type !== "TEXT" && type !== "INSTANCE_SWAP") {
        throw new Error(`type must be BOOLEAN | TEXT | INSTANCE_SWAP, got: ${type}`);
      }
      let defaultValue: any;
      const options: any = {};
      if (type === "TEXT") {
        defaultValue = typeof p.defaultValueText === "string" ? p.defaultValueText : "";
      } else if (type === "BOOLEAN") {
        defaultValue = typeof p.defaultValueBoolean === "boolean" ? p.defaultValueBoolean : true;
      } else {
        // INSTANCE_SWAP — defaultValue must be a componentKey (not id).
        const resolveKey = async (idOrKey: string): Promise<string> => {
          if (!idOrKey) return "";
          if (idOrKey.indexOf(":") === -1) return idOrKey; // already a key
          const ref = await figma.getNodeByIdAsync(idOrKey) as any;
          if (!ref) throw new Error(`Component not found: ${idOrKey}`);
          if (ref.type !== "COMPONENT") throw new Error(`Node ${idOrKey} is not a COMPONENT`);
          return ref.key;
        };
        defaultValue = await resolveKey(p.defaultValueInstanceKey || "");
        if (!defaultValue) throw new Error("defaultValueInstanceKey is required for INSTANCE_SWAP");
        if (Array.isArray(p.preferredValuesInstanceKeys) && p.preferredValuesInstanceKeys.length > 0) {
          const pref: any[] = [];
          for (const v of p.preferredValuesInstanceKeys as string[]) {
            const key = await resolveKey(v);
            if (key) pref.push({ type: "COMPONENT", key });
          }
          if (pref.length) options.preferredValues = pref;
        }
      }
      const propertyName: string = node.addComponentProperty(name, type, defaultValue, options);
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: node.id, name: node.name, propertyName, propertyType: type, defaultValue },
      };
    }

    case "delete_component_property": {
      const p = request.params || {};
      const nodeId = request.nodeIds && request.nodeIds[0];
      if (!nodeId) throw new Error("nodeId is required");
      const node = await figma.getNodeByIdAsync(nodeId) as any;
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
        throw new Error(`Node ${nodeId} is not a COMPONENT or COMPONENT_SET`);
      }
      const propertyName = p.propertyName;
      if (!propertyName) throw new Error("propertyName is required");
      node.deleteComponentProperty(propertyName);
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: node.id, propertyName, deleted: true },
      };
    }

    case "list_component_properties": {
      const nodeId = request.nodeIds && request.nodeIds[0];
      if (!nodeId) throw new Error("nodeId is required");
      const node = await figma.getNodeByIdAsync(nodeId) as any;
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
        throw new Error(`Node ${nodeId} is not a COMPONENT or COMPONENT_SET`);
      }
      const defs = node.componentPropertyDefinitions || {};
      const properties = Object.keys(defs).map((propertyName) => {
        const d = defs[propertyName];
        return {
          propertyName,
          type: d.type,
          defaultValue: d.defaultValue,
          preferredValues: d.preferredValues,
        };
      });
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: node.id, name: node.name, properties },
      };
    }

    case "set_component_property_reference": {
      const p = request.params || {};
      const nodeId = request.nodeIds && request.nodeIds[0];
      if (!nodeId) throw new Error("nodeId is required");
      const node = await figma.getNodeByIdAsync(nodeId) as any;
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      const field = p.field;
      if (field !== "visible" && field !== "characters" && field !== "mainComponent") {
        throw new Error(`field must be visible | characters | mainComponent, got: ${field}`);
      }
      if (field === "characters" && node.type !== "TEXT") {
        throw new Error(`Node ${nodeId} is not a TEXT node — required for field='characters'`);
      }
      if (field === "mainComponent" && node.type !== "INSTANCE") {
        throw new Error(`Node ${nodeId} is not an INSTANCE — required for field='mainComponent'`);
      }
      const current = (node.componentPropertyReferences || {}) as Record<string, string>;
      const next: Record<string, string | null> = { ...current };
      const propertyName = typeof p.propertyName === "string" ? p.propertyName : "";
      next[field] = propertyName ? propertyName : null;
      node.componentPropertyReferences = next;
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: node.id, field, propertyName: propertyName || null },
      };
    }

    case "set_instance_properties": {
      const p = request.params || {};
      const nodeId = request.nodeIds && request.nodeIds[0];
      if (!nodeId) throw new Error("nodeId is required");
      const node = await figma.getNodeByIdAsync(nodeId) as any;
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      if (node.type !== "INSTANCE") throw new Error(`Node ${nodeId} is not an INSTANCE`);
      const props = (p.properties || {}) as Record<string, any>;
      if (!props || typeof props !== "object") throw new Error("properties is required");

      // For INSTANCE_SWAP values: resolve componentId (colon format) to componentKey.
      // We detect INSTANCE_SWAP by checking the main component's property definitions.
      const mainComponent: any = await (node as any).getMainComponentAsync();
      const set: any = mainComponent && mainComponent.parent && mainComponent.parent.type === "COMPONENT_SET" ? mainComponent.parent : null;
      const defsHost: any = set || mainComponent;
      const defs: Record<string, any> = (defsHost && defsHost.componentPropertyDefinitions) || {};
      const resolved: Record<string, any> = {};
      for (const key of Object.keys(props)) {
        let value = props[key];
        const def = defs[key];
        if (def && def.type === "INSTANCE_SWAP" && typeof value === "string" && value.indexOf(":") !== -1) {
          const ref = await figma.getNodeByIdAsync(value) as any;
          if (!ref) throw new Error(`Component not found for property ${key}: ${value}`);
          if (ref.type !== "COMPONENT") throw new Error(`Node ${value} for property ${key} is not a COMPONENT`);
          value = ref.key;
        }
        resolved[key] = value;
      }
      node.setProperties(resolved);
      figma.commitUndo();
      return {
        type: request.type,
        requestId: request.requestId,
        data: { id: node.id, properties: node.componentProperties },
      };
    }

    default:
      return null;
  }
};
