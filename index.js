const core = require(`@actions/core`);
const github = require(`@actions/github`);
const azdev = require(`azure-devops-node-api`);

async function main() {
	const payload = github.context.payload;
	const issueOrPr = payload.issue || payload.pull_request;
	const isIssue = payload.issue != null;
	const isPR = payload.pull_request != null;

	if (core.getInput('label') && !issueOrPr.labels.some(label => label.name === core.getInput('label'))) {
		console.log(`Action was configured to only run when issue or PR has label ${core.getInput('label')}, but we couldn't find it.`);
		return;
	}

	let adoClient = null;

	try {
		const orgUrl = "https://dev.azure.com/" + core.getInput('ado_organization');
		const adoAuthHandler = azdev.getPersonalAccessTokenHandler(process.env.ado_token);
		const adoConnection = new azdev.WebApi(orgUrl, adoAuthHandler);
		adoClient = await adoConnection.getWorkItemTrackingApi();
	} catch (e) {
		console.error(e);
		core.setFailed('Could not connect to ADO');
		return;
	}

	try {
		let workItem = null;

		if (!core.getInput('ado_dont_check_if_exist')) {
			// go check to see if work item already exists in azure devops or not
			// based on the title and tags.
			console.log("Check to see if work item already exists");
			workItem = await find(issueOrPr.number, adoClient);
			if (workItem === null) {
				console.log("Could not find existing ADO workitem, creating one now");
			} else {
				console.log("Found existing ADO workitem: " + workItem.id + ". No need to create a new one");
				return;
			}

			// if workItem == -1 then we have an error during find
			if (workItem === -1) {
				core.setFailed("Error while finding the ADO work item");
				return;
			}
		}


		workItem = await create(payload, adoClient);

		// Add the work item number at the end of the github issue body.
		issueOrPr.body += "\n\nAB#" + workItem.id;
		const octokit = new github.GitHub(process.env.github_token);

		if (isIssue) {
			await octokit.issues.update({
				owner: payload.repository.owner.login,
				repo: payload.repository.name,
				issue_number: issueOrPr.number,
				body: issueOrPr.body
			});
		} else if (isPR) {
			await octokit.pulls.update({
				owner: payload.repository.owner.login,
				repo: payload.repository.name,
				pull_number: issueOrPr.number,
				body: issueOrPr.body
			});
		}

		// set output message
		if (workItem != null || workItem != undefined) {
			console.log(`Work item successfully created or found: ${workItem.id}`);
			core.setOutput(`id`, `${workItem.id}`);
		}
	} catch (error) {
		console.log("Error: " + error);
		core.setFailed();
	}
}

function formatTitle(issueOrPr) {
	return "[GitHub #" + issueOrPr.number + "] " + issueOrPr.title;
}

async function formatDescription(payload) {
	console.log('Creating a description based on the github issue');

	const issueOrPr = payload.issue || payload.pull_request;
	const octokit = new github.GitHub(process.env.github_token);
	const bodyWithMarkdown = await octokit.markdown.render({
		text: issueOrPr.body,
		mode: "gfm",
		context: payload.repository.full_name
	});

	return '<em>This item was auto-opened from GitHub <a href="' +
		issueOrPr.html_url +
		'" target="_new">issue or PR#' +
		issueOrPr.number +
		"</a></em><br>" +
		"It won't auto-update when the GitHub issue or PR changes so please check the issue or PR for updates.<br><br>" +
		"<strong>Initial description from GitHub:</strong><br><br>" +
		bodyWithMarkdown.data;
}

async function create(payload, adoClient) {
	const issueOrPr = payload.issue || payload.pull_request;
	const botMessage = await formatDescription(payload);
	const shortRepoName = payload.repository.full_name.split("/")[1];
	const tags = core.getInput("ado_tags") ? core.getInput("ado_tags") + ";" + shortRepoName : shortRepoName;
	const itemType = core.getInput("ado_work_item_type") ? core.getInput("ado_work_item_type") : "Bug";

	console.log(`Starting to create a ${itemType} work item for GitHub issue or PR #${issueOrPr.number}`);

	const patchDocument = [
		{
			op: "add",
			path: "/fields/System.Title",
			value: formatTitle(issueOrPr),
		},
		{
			op: "add",
			path: "/fields/System.Description",
			value: botMessage,
		},
		{
			op: "add",
			path: "/fields/Microsoft.VSTS.TCM.ReproSteps",
			value: botMessage,
		},
		{
			op: "add",
			path: "/fields/System.Tags",
			value: tags,
		},
		{
			op: "add",
			path: "/relations/-",
			value: {
				rel: "Hyperlink",
				url: issueOrPr.html_url,
			},
		}
	];

	if (core.getInput('parent_work_item')) {
		let parentUrl = "https://dev.azure.com/" + core.getInput('ado_organization');
		parentUrl += '/_workitems/edit/' + core.getInput('parent_work_item');

		patchDocument.push({
			op: "add",
			path: "/relations/-",
			value: {
				rel: "System.LinkTypes.Hierarchy-Reverse",
				url: parentUrl,
				attributes: {
					comment: ""
				}
			}
		});
	}

	patchDocument.push({
		op: "add",
		path: "/fields/System.AreaPath",
		value: core.getInput('ado_area_path'),
	});

	let workItemSaveResult = null;

	try {
		console.log('Creating work item');
		workItemSaveResult = await adoClient.createWorkItem(
			(customHeaders = []),
			(document = patchDocument),
			(project = core.getInput('ado_project')),
			(type = itemType),
			(validateOnly = false),
			(bypassRules = false)
		);

		// if result is null, save did not complete correctly
		if (workItemSaveResult == null) {
			workItemSaveResult = -1;

			console.log("Error: createWorkItem failed");
			console.log(`WIT may not be correct: ${wit}`);
			core.setFailed();
		} else {
			console.log("Work item successfully created");
		}
	} catch (error) {
		workItemSaveResult = -1;

		console.log("Error: createWorkItem failed");
		console.log(patchDocument);
		console.log(error);
		core.setFailed(error);
	}

	if (workItemSaveResult != -1) {
		console.log(workItemSaveResult);
	}

	return workItemSaveResult;
}

async function find(ghNb, adoClient) {
	console.log('Connecting to Azure DevOps to find work item for issue or PR #' + ghNb);

	const wiql = {
		query:
			`SELECT [System.Id], [System.WorkItemType], [System.Description], [System.Title], [System.AssignedTo], [System.State], [System.Tags]
			FROM workitems 
			WHERE [System.TeamProject] = @project AND [System.Title] CONTAINS '[GitHub #${ghNb}]' AND [System.AreaPath] = '${core.getInput('ado_area_path')}'`
	};
	console.log("ADO query: " + wiql.query);

	let queryResult = null;
	try {
		queryResult = await adoClient.queryByWiql(wiql, { project: core.getInput('ado_project') });

		// if query results = null then i think we have issue with the project name
		if (queryResult == null) {
			console.log("Error: Project name appears to be invalid");
			core.setFailed("Error: Project name appears to be invalid");
			return -1;
		}
	} catch (error) {
		console.log("Error: queryByWiql failure");
		console.log(error);
		core.setFailed(error);
		return -1;
	}

	console.log("Use the first item found");
	const workItem = queryResult.workItems.length > 0 ? queryResult.workItems[0] : null;

	if (workItem != null) {
		try {
			var result = await adoClient.getWorkItem(workItem.id, null, null, 4);
			console.log("Workitem data retrieved: " + workItem.id);
			return result;
		} catch (error) {
			console.log("Error: getWorkItem failure");
			core.setFailed(error);
			return -1;
		}
	} else {
		return null;
	}
}

main();
