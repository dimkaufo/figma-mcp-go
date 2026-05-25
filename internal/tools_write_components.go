package internal

import (
	"context"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

func registerWriteComponentTools(s *server.MCPServer, node *Node) {
	s.AddTool(mcp.NewTool("navigate_to_page",
		mcp.WithDescription("Switch the active Figma page. Provide either pageId or pageName."),
		mcp.WithString("pageId", mcp.Description("Page node ID in colon format e.g. '0:1'")),
		mcp.WithString("pageName", mcp.Description("Exact page name to navigate to")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		params := map[string]interface{}{}
		if id, ok := req.GetArguments()["pageId"].(string); ok && id != "" {
			params["pageId"] = id
		}
		if name, ok := req.GetArguments()["pageName"].(string); ok && name != "" {
			params["pageName"] = name
		}
		resp, err := node.Send(ctx, "navigate_to_page", nil, params)
		return renderResponse(resp, err)
	})

	s.AddTool(mcp.NewTool("group_nodes",
		mcp.WithDescription("Group two or more nodes into a GROUP. All nodes must share the same parent."),
		mcp.WithArray("nodeIds",
			mcp.Required(),
			mcp.Description("Node IDs to group (minimum 2), in colon format e.g. ['4029:12345', '4029:12346']"),
			mcp.WithStringItems(),
		),
		mcp.WithString("name", mcp.Description("Optional name for the new group")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		raw, _ := req.GetArguments()["nodeIds"].([]interface{})
		nodeIDs := toStringSlice(raw)
		params := map[string]interface{}{}
		if name, ok := req.GetArguments()["name"].(string); ok && name != "" {
			params["name"] = name
		}
		resp, err := node.Send(ctx, "group_nodes", nodeIDs, params)
		return renderResponse(resp, err)
	})

	s.AddTool(mcp.NewTool("ungroup_nodes",
		mcp.WithDescription("Ungroup one or more GROUP nodes, moving their children to the parent and removing the group."),
		mcp.WithArray("nodeIds",
			mcp.Required(),
			mcp.Description("GROUP node IDs in colon format e.g. ['4029:12345']"),
			mcp.WithStringItems(),
		),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		raw, _ := req.GetArguments()["nodeIds"].([]interface{})
		nodeIDs := toStringSlice(raw)
		resp, err := node.Send(ctx, "ungroup_nodes", nodeIDs, nil)
		return renderResponse(resp, err)
	})


	s.AddTool(mcp.NewTool("swap_component",
		mcp.WithDescription("Swap the main component of an existing INSTANCE node, replacing it with a different component while keeping position and size."),
		mcp.WithString("nodeId",
			mcp.Required(),
			mcp.Description("INSTANCE node ID in colon format e.g. 4029:12345"),
		),
		mcp.WithString("componentId",
			mcp.Required(),
			mcp.Description("Target COMPONENT node ID in colon format (from get_local_components)"),
		),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		nodeID, _ := args["nodeId"].(string)
		nodeID = NormalizeNodeID(nodeID)
		componentID, _ := args["componentId"].(string)
		componentID = NormalizeNodeID(componentID)
		params := map[string]interface{}{"componentId": componentID}
		resp, err := node.Send(ctx, "swap_component", []string{nodeID}, params)
		return renderResponse(resp, err)
	})

	s.AddTool(mcp.NewTool("detach_instance",
		mcp.WithDescription("Detach one or more component instances, converting them to plain frames. The link to the main component is broken; all visual properties are preserved."),
		mcp.WithArray("nodeIds",
			mcp.Required(),
			mcp.Description("INSTANCE node IDs in colon format e.g. ['4029:12345']"),
			mcp.WithStringItems(),
		),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		raw, _ := req.GetArguments()["nodeIds"].([]interface{})
		nodeIDs := toStringSlice(raw)
		for i, id := range nodeIDs {
			nodeIDs[i] = NormalizeNodeID(id)
		}
		resp, err := node.Send(ctx, "detach_instance", nodeIDs, nil)
		return renderResponse(resp, err)
	})

	s.AddTool(mcp.NewTool("add_component_property",
		mcp.WithDescription("Add a Component Property to a COMPONENT or COMPONENT_SET. The returned propertyName is the canonical name (e.g. 'Label#1234') and must be used when binding via set_component_property_reference or set_instance_properties. Use type BOOLEAN to toggle visibility, TEXT to override characters, INSTANCE_SWAP to swap a sub-instance."),
		mcp.WithString("nodeId",
			mcp.Required(),
			mcp.Description("COMPONENT or COMPONENT_SET node ID, colon format e.g. '4029:12345'"),
		),
		mcp.WithString("name",
			mcp.Required(),
			mcp.Description("Human-readable property name shown in the Figma instance inspector (e.g. 'Label 1', 'Show icon', 'Icon')."),
		),
		mcp.WithString("type",
			mcp.Required(),
			mcp.Description("Property type: BOOLEAN | TEXT | INSTANCE_SWAP. VARIANT properties are created automatically by combining variants into a set — not exposed here."),
		),
		mcp.WithString("defaultValueText", mcp.Description("Default value when type=TEXT (e.g. 'Continue').")),
		mcp.WithBoolean("defaultValueBoolean", mcp.Description("Default value when type=BOOLEAN.")),
		mcp.WithString("defaultValueInstanceKey", mcp.Description("Default value when type=INSTANCE_SWAP — pass the target component id (colon format) OR componentKey. Plugin resolves to mainComponent.key.")),
		mcp.WithArray("preferredValuesInstanceKeys",
			mcp.Description("Optional list of componentIds (colon format) or componentKeys shown in the instance-swap dropdown for INSTANCE_SWAP properties."),
			mcp.WithStringItems(),
		),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		nodeID, _ := args["nodeId"].(string)
		nodeID = NormalizeNodeID(nodeID)
		params := map[string]interface{}{}
		if name, ok := args["name"].(string); ok && name != "" {
			params["name"] = name
		}
		if t, ok := args["type"].(string); ok && t != "" {
			params["propertyType"] = t
		}
		if v, ok := args["defaultValueText"].(string); ok {
			params["defaultValueText"] = v
		}
		if v, ok := args["defaultValueBoolean"].(bool); ok {
			params["defaultValueBoolean"] = v
		}
		if v, ok := args["defaultValueInstanceKey"].(string); ok && v != "" {
			params["defaultValueInstanceKey"] = v
		}
		if raw, ok := args["preferredValuesInstanceKeys"].([]interface{}); ok {
			params["preferredValuesInstanceKeys"] = toStringSlice(raw)
		}
		resp, err := node.Send(ctx, "add_component_property", []string{nodeID}, params)
		return renderResponse(resp, err)
	})

	s.AddTool(mcp.NewTool("delete_component_property",
		mcp.WithDescription("Delete a Component Property from a COMPONENT or COMPONENT_SET by its canonical property name."),
		mcp.WithString("nodeId",
			mcp.Required(),
			mcp.Description("COMPONENT or COMPONENT_SET node ID, colon format"),
		),
		mcp.WithString("propertyName",
			mcp.Required(),
			mcp.Description("Canonical property name returned by add_component_property (e.g. 'Label#1234')."),
		),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		nodeID, _ := args["nodeId"].(string)
		nodeID = NormalizeNodeID(nodeID)
		propertyName, _ := args["propertyName"].(string)
		params := map[string]interface{}{"propertyName": propertyName}
		resp, err := node.Send(ctx, "delete_component_property", []string{nodeID}, params)
		return renderResponse(resp, err)
	})

	s.AddTool(mcp.NewTool("list_component_properties",
		mcp.WithDescription("List all Component Property definitions on a COMPONENT or COMPONENT_SET — returns name, type, default value, and (for INSTANCE_SWAP) preferredValues."),
		mcp.WithString("nodeId",
			mcp.Required(),
			mcp.Description("COMPONENT or COMPONENT_SET node ID, colon format"),
		),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		nodeID, _ := req.GetArguments()["nodeId"].(string)
		nodeID = NormalizeNodeID(nodeID)
		resp, err := node.Send(ctx, "list_component_properties", []string{nodeID}, nil)
		return renderResponse(resp, err)
	})

	s.AddTool(mcp.NewTool("set_component_property_reference",
		mcp.WithDescription("Bind (or clear) a child node's field to a Component Property defined on the enclosing COMPONENT/COMPONENT_SET. The child node must be a descendant of the component. Use field='visible' for BOOLEAN, 'characters' for TEXT (TEXT node only), 'mainComponent' for INSTANCE_SWAP (INSTANCE node only). Pass an empty propertyName to clear the binding."),
		mcp.WithString("nodeId",
			mcp.Required(),
			mcp.Description("Child node ID inside the component, colon format. For TEXT binding use a TEXT node id; for mainComponent use an INSTANCE node id."),
		),
		mcp.WithString("field",
			mcp.Required(),
			mcp.Description("Field to bind: visible | characters | mainComponent."),
		),
		mcp.WithString("propertyName",
			mcp.Description("Canonical property name returned by add_component_property. Omit or pass empty string to clear the existing binding for this field."),
		),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		nodeID, _ := args["nodeId"].(string)
		field, _ := args["field"].(string)
		propertyName, _ := args["propertyName"].(string)
		params := map[string]interface{}{
			"field":        field,
			"propertyName": propertyName,
		}
		resp, err := node.Send(ctx, "set_component_property_reference", []string{nodeID}, params)
		return renderResponse(resp, err)
	})

	s.AddTool(mcp.NewTool("recolor_node_tree",
		mcp.WithDescription("Walk a node and its descendants, replacing every SOLID paint with the given color. Useful as a one-shot 'set icon color' after swap_component — recursively retints every Vector/Frame/etc. that supports fills or strokes. Non-SOLID paints (gradients, images) are left untouched. Skips nodes that don't support the targeted property."),
		mcp.WithString("nodeId",
			mcp.Required(),
			mcp.Description("Root node ID, colon format. Nested instance child IDs (I…;…) are supported."),
		),
		mcp.WithString("color",
			mcp.Required(),
			mcp.Description("Target color hex (#RRGGBB or #RRGGBBAA)."),
		),
		mcp.WithString("target",
			mcp.Description("Which paint property to retint: 'fill' | 'stroke' | 'both' (default 'both')."),
		),
		mcp.WithBoolean("includeRoot",
			mcp.Description("Include the root node itself in the retint, or only descendants (default true)."),
		),
		mcp.WithNumber("maxDepth",
			mcp.Description("Maximum recursion depth (default 50)."),
		),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		nodeID, _ := args["nodeId"].(string)
		color, _ := args["color"].(string)
		params := map[string]interface{}{"color": color}
		if t, ok := args["target"].(string); ok && t != "" {
			params["target"] = t
		}
		if v, ok := args["includeRoot"].(bool); ok {
			params["includeRoot"] = v
		}
		if v, ok := args["maxDepth"].(float64); ok {
			params["maxDepth"] = v
		}
		resp, err := node.Send(ctx, "recolor_node_tree", []string{nodeID}, params)
		return renderResponse(resp, err)
	})

	s.AddTool(mcp.NewTool("set_instance_properties",
		mcp.WithDescription("Set Component Property values on an INSTANCE — overrides text, visibility, and instance swaps for any properties defined on its main component. Property names must be the canonical names (e.g. 'Label#1234'). For INSTANCE_SWAP values pass the target component's id (colon format) OR componentKey; the plugin resolves to a key."),
		mcp.WithString("nodeId",
			mcp.Required(),
			mcp.Description("INSTANCE node ID, colon format. Nested instance child IDs (I…;…) are supported."),
		),
		mcp.WithObject("properties",
			mcp.Required(),
			mcp.Description("Map of canonical propertyName → value. Value types: string for TEXT, boolean for BOOLEAN, string (componentId or componentKey) for INSTANCE_SWAP."),
		),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		nodeID, _ := args["nodeId"].(string)
		props, _ := args["properties"].(map[string]interface{})
		params := map[string]interface{}{"properties": props}
		resp, err := node.Send(ctx, "set_instance_properties", []string{nodeID}, params)
		return renderResponse(resp, err)
	})
}
